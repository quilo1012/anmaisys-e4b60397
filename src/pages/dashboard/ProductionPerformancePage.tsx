import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Medal } from "lucide-react";
import { format, parseISO, addDays, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LineChart, Line } from "recharts";
import { CircularProgress } from "@/components/ui/circular-progress";
import { Badge } from "@/components/ui/badge";

type Period = "day" | "week" | "month";

interface SessionAgg {
  id: string; session_date: string; shift: string; line: string;
  leader_name: string | null; locked: boolean;
  target: number; actual: number; eff: number;
  items: { sku_id: string; actual: number }[];
}

export default function ProductionPerformancePage() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [period, setPeriod] = useState<Period>("day");
  const [shift, setShift] = useState<"all" | "DAY" | "NIGHT">("all");
  const [lineFilter, setLineFilter] = useState<string>("__all__");
  const qc = useQueryClient();

  // Pull latest actuals from iTouching every 60s while page is open
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const effectiveShift = shift === "all"
          ? (new Date().getHours() >= 6 && new Date().getHours() < 18 ? "DAY" : "NIGHT")
          : shift;
        const { error } = await supabase.functions.invoke("intouch-sync-production", {
          body: { session_date: date, shift: effectiveShift },
        });
        if (error) {
          // 429 quota exhausted or transient iTouching failures: ignore silently, RAG data still renders
          console.warn("intouch-sync-production skipped:", error?.message ?? error);
        }
        if (!cancelled) qc.invalidateQueries({ queryKey: ["oee"] });
      } catch (e) {
        console.warn("intouch-sync-production failed", e);
      }
    };
    run();
    const id = setInterval(run, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [date, shift, qc]);

  const range = useMemo(() => {
    const d = parseISO(date);
    if (period === "day") return { from: date, to: date };
    if (period === "week") return { from: format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: format(endOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd") };
    return { from: format(startOfMonth(d), "yyyy-MM-dd"), to: format(endOfMonth(d), "yyyy-MM-dd") };
  }, [date, period]);

  const { data: lines = [] } = useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const { data } = await supabase.from("lines").select("name").order("name");
      return (data ?? []) as { name: string }[];
    },
  });

  const { data: skus = [] } = useQuery({
    queryKey: ["sku_products_min"],
    queryFn: async () => {
      const { data } = await supabase.from("sku_products").select("id, code, name");
      return (data ?? []) as { id: string; code: string; name: string }[];
    },
  });
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  const { data: sessions = [] } = useQuery<SessionAgg[]>({
    queryKey: ["oee", range.from, range.to, shift, lineFilter],
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      let q = supabase.from("production_sessions")
        .select("id, session_date, shift, line, leader_name, locked, production_items(sku_id, target_qty, planned_qty, actual_qty)")
        .gte("session_date", range.from).lte("session_date", range.to);
      if (shift !== "all") q = q.eq("shift", shift);
      if (lineFilter !== "__all__") q = q.eq("line", lineFilter);

      // Target comes from RAG Weekly (plan_qty), NOT from SKU per-item targets.
      let rq = supabase.from("rag_weekly_entries")
        .select("entry_date, line, shift, plan_qty, actual_qty")
        .gte("entry_date", range.from).lte("entry_date", range.to);
      if (shift !== "all") rq = rq.eq("shift", shift);
      if (lineFilter !== "__all__") rq = rq.eq("line", lineFilter);

      const [{ data, error }, { data: ragData, error: ragErr }] = await Promise.all([q, rq]);
      if (error) throw error;
      if (ragErr) throw ragErr;

      const ragPlanMap = new Map<string, number>();
      const ragActualMap = new Map<string, number>();
      for (const r of (ragData ?? []) as { entry_date: string; line: string; shift: string; plan_qty: number | null; actual_qty: number | null }[]) {
        const k = `${r.entry_date}|${r.line}|${r.shift}`;
        ragPlanMap.set(k, Number(r.plan_qty ?? 0));
        ragActualMap.set(k, Number(r.actual_qty ?? 0));
      }

      return (data ?? []).map((s: { id: string; session_date: string; shift: string; line: string; leader_name: string | null; locked: boolean; production_items: { sku_id: string; target_qty: number | null; planned_qty: number | null; actual_qty: number | null }[] }) => {
        const items = s.production_items ?? [];
        const key = `${s.session_date}|${s.line}|${s.shift}`;
        const target = ragPlanMap.get(key) ?? 0;
        const itemsActual = items.reduce((a, i) => a + Number(i.actual_qty ?? 0), 0);
        // Prefer RAG Weekly actual when it's been recorded (source of truth for the line/shift);
        // fall back to summed production_items when RAG has no actual yet.
        const ragActual = ragActualMap.get(key) ?? 0;
        const actual = ragActual > 0 ? ragActual : itemsActual;
        return { id: s.id, session_date: s.session_date, shift: s.shift, line: s.line, leader_name: s.leader_name, locked: s.locked, target, actual, eff: target > 0 ? (actual / target) * 100 : 0, items: items.map((i) => ({ sku_id: i.sku_id, actual: Number(i.actual_qty ?? 0) })) };
      });
    },
  });



  const topSkus = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) for (const i of s.items) {
      if (!i.sku_id) continue;
      m.set(i.sku_id, (m.get(i.sku_id) ?? 0) + i.actual);
    }
    return Array.from(m.entries())
      .map(([sku_id, actual]) => ({ label: skuMap.get(sku_id)?.code ?? "?", name: skuMap.get(sku_id)?.name ?? "", actual }))
      .sort((a, b) => b.actual - a.actual).slice(0, 10);
  }, [sessions, skuMap]);

  const byLeader = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) {
      if (!s.leader_name) continue;
      m.set(s.leader_name, (m.get(s.leader_name) ?? 0) + s.actual);
    }
    return Array.from(m.entries()).map(([leader, actual]) => ({ leader, actual }))
      .sort((a, b) => b.actual - a.actual).slice(0, 10);
  }, [sessions]);

  const byLine = useMemo(() => {
    const map = new Map<string, { line: string; target: number; actual: number; leader: string | null }>();
    for (const s of sessions) {
      const cur = map.get(s.line) ?? { line: s.line, target: 0, actual: 0, leader: s.leader_name };
      cur.target += s.target; cur.actual += s.actual; cur.leader = s.leader_name ?? cur.leader;
      map.set(s.line, cur);
    }
    return Array.from(map.values()).map((x) => ({ ...x, eff: x.target > 0 ? (x.actual / x.target) * 100 : 0 })).sort((a, b) => b.eff - a.eff);
  }, [sessions]);

  const trend = useMemo(() => {
    const map = new Map<string, { date: string; target: number; actual: number }>();
    for (const s of sessions) {
      const cur = map.get(s.session_date) ?? { date: s.session_date, target: 0, actual: 0 };
      cur.target += s.target; cur.actual += s.actual;
      map.set(s.session_date, cur);
    }
    return Array.from(map.values()).map((x) => ({ ...x, eff: x.target > 0 ? (x.actual / x.target) * 100 : 0 })).sort((a, b) => a.date.localeCompare(b.date));
  }, [sessions]);

  const leaderboard = useMemo(() => {
    const map = new Map<string, { leader: string; sessions: number; target: number; actual: number }>();
    for (const s of sessions) {
      if (!s.leader_name) continue;
      const cur = map.get(s.leader_name) ?? { leader: s.leader_name, sessions: 0, target: 0, actual: 0 };
      cur.sessions += 1; cur.target += s.target; cur.actual += s.actual;
      map.set(s.leader_name, cur);
    }
    return Array.from(map.values()).map((x) => ({ ...x, eff: x.target > 0 ? (x.actual / x.target) * 100 : 0 })).sort((a, b) => b.eff - a.eff).slice(0, 10);
  }, [sessions]);

  const lineRank = (name: string) => {
    const n = (name ?? "").toLowerCase();
    const m = n.match(/line\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    if (n.includes("capsule")) return 100;
    if (n.includes("gel")) return 200;
    return 999;
  };
  const sortedByLine = useMemo(() => [...byLine].sort((a, b) => lineRank(a.line) - lineRank(b.line) || a.line.localeCompare(b.line)), [byLine]);
  const sortedLines = useMemo(() => [...lines].sort((a, b) => lineRank(a.name) - lineRank(b.name) || a.name.localeCompare(b.name)), [lines]);

  const ragColor = (e: number) => e >= 100 ? "border-green-500" : e >= 80 ? "border-amber-500" : "border-red-500";
  const ragFill = (e: number) => e >= 100 ? "hsl(142 76% 36%)" : e >= 80 ? "hsl(38 92% 50%)" : "hsl(0 84% 60%)";
  const medal = (i: number) => i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;


  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Production Performance</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="icon" onClick={() => setDate(format(subDays(parseISO(date), 1), "yyyy-MM-dd"))}><ChevronLeft className="h-4 w-4" /></Button>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            <Button variant="outline" size="icon" onClick={() => setDate(format(addDays(parseISO(date), 1), "yyyy-MM-dd"))}><ChevronRight className="h-4 w-4" /></Button>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="day">Day</SelectItem><SelectItem value="week">Week</SelectItem><SelectItem value="month">Month</SelectItem></SelectContent>
            </Select>
            <Select value={shift} onValueChange={(v) => setShift(v as "all" | "DAY" | "NIGHT")}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
            </Select>
            <Select value={lineFilter} onValueChange={setLineFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All lines</SelectItem>
                {sortedLines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Overall OEE Panel — excludes lines with no RAG Weekly target for the period (#9) */}
        {(() => {
          const scored = byLine.filter((l) => l.target > 0);
          const totalTarget = scored.reduce((a, l) => a + l.target, 0);
          const totalActual = scored.reduce((a, l) => a + l.actual, 0);
          const overall = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;
          const excludedCount = byLine.length - scored.length;
          return (
            <Card>
              <CardContent className="p-6 flex items-center gap-6 flex-wrap">
                <CircularProgress value={overall} size={120} strokeWidth={10} sublabel="Overall" />
                <div className="flex-1 min-w-[200px]">
                  <div className="text-xs uppercase text-muted-foreground">Overall Performance</div>
                  <div className="text-2xl font-bold">{totalActual.toLocaleString()} / {totalTarget.toLocaleString()}</div>
                  <div className="text-sm text-muted-foreground">
                    {scored.length} {scored.length === 1 ? "line" : "lines"} scored · {sessions.length} sessions
                    {excludedCount > 0 && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">· {excludedCount} without RAG target excluded</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Badge className="bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/40">≥100% Green</Badge>
                  <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40">≥80% Amber</Badge>
                  <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/40">&lt;80% Red</Badge>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Line status cards */}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedByLine.length === 0 && <Card><CardContent className="p-4 text-muted-foreground">No data</CardContent></Card>}
          {sortedByLine.map((l) => {

            const headerBg = l.eff >= 100 ? "bg-green-500/15" : l.eff >= 80 ? "bg-amber-500/15" : "bg-red-500/15";
            const headerText = l.eff >= 100 ? "text-green-600 dark:text-green-400" : l.eff >= 80 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
            return (
              <Card key={l.line} className={`overflow-hidden border-l-4 ${ragColor(l.eff)}`}>
                <div className={`${headerBg} ${headerText} px-4 py-2 flex items-center justify-between`}>
                  <div className="font-semibold">{l.line}</div>
                  <div className="text-xs">{l.leader ?? "—"}</div>
                </div>
                <CardContent className="p-4 flex items-center gap-4">
                  <CircularProgress value={l.eff} size={88} strokeWidth={8} />
                  <div className="flex-1 text-sm space-y-0.5">
                    <div className="flex justify-between"><span className="text-muted-foreground">Target</span><span className="font-medium">{l.target.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Actual</span><span className="font-medium">{l.actual.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Gap</span><span className={`font-medium ${l.actual - l.target >= 0 ? "text-green-500" : "text-red-500"}`}>{(l.actual - l.target).toLocaleString()}</span></div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </DashboardLayout>

  );
}
