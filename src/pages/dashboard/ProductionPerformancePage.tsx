import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/DashboardLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Medal, BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { format, parseISO, addDays, subDays, addWeeks, addMonths, addQuarters, addYears, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, LineChart, Line } from "recharts";
import { CircularProgress } from "@/components/ui/circular-progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

type Period = "day" | "week" | "month" | "quarter" | "year" | "custom";

interface SessionAgg {
  id: string; session_date: string; shift: string; line: string;
  leader_name: string | null; locked: boolean;
  target: number; actual: number; eff: number;
  items: { sku_id: string; actual: number }[];
}

export default function ProductionPerformancePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [period, setPeriod] = useState<Period>("day");
  const [shift, setShift] = useState<"all" | "DAY" | "NIGHT">("all");
  const [lineFilter, setLineFilter] = useState<string>("__all__");
  const [leaderFilter, setLeaderFilter] = useState<string>("__all__");
  const [savingLeaderFor, setSavingLeaderFor] = useState<string | null>(null);
  const [addingLeaderFor, setAddingLeaderFor] = useState<string | null>(null);
  const [newLeaderName, setNewLeaderName] = useState("");

  const addNewLeader = async (lineName: string, hasSession: boolean) => {
    const name = newLeaderName.trim();
    if (!name) {
      toast.error("Leader name required");
      return;
    }
    setSavingLeaderFor(lineName);
    try {
      const { error } = await supabase.from("line_leaders").insert({ name, shift: "BOTH", active: true });
      if (error && !/duplicate|unique/i.test(error.message)) throw error;
      await qc.invalidateQueries({ queryKey: ["line_leaders_active"] });
      setAddingLeaderFor(null);
      setNewLeaderName("");
      await setLeaderForLine(lineName, name, hasSession);
      toast.success(`Leader "${name}" added`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to add leader");
      setSavingLeaderFor(null);
    }
  };

  const setLeaderForLine = async (lineName: string, leaderName: string | null, hasSession: boolean) => {
    setSavingLeaderFor(lineName);
    try {
      if (hasSession) {
        let q = supabase.from("production_sessions")
          .update({ leader_name: leaderName })
          .eq("line", lineName)
          .gte("session_date", range.from)
          .lte("session_date", range.to);
        if (shift !== "all") q = q.eq("shift", shift);
        const { error } = await q;
        if (error) throw error;
      } else {
        // No session exists yet for this line/range — create one so the leader assignment sticks.
        const sessionShift = shift === "all" ? "DAY" : shift;
        const { error } = await supabase.from("production_sessions").insert({
          line: lineName,
          session_date: range.from,
          shift: sessionShift,
          leader_name: leaderName,
        });
        if (error) throw error;
      }
      toast.success(leaderName ? `Leader set to ${leaderName} for ${lineName}` : `Leader cleared for ${lineName}`);
      qc.invalidateQueries({ queryKey: ["oee"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to update leader");
    } finally {
      setSavingLeaderFor(null);
    }
  };


  const range = useMemo(() => {
    const d = parseISO(date);
    if (period === "day") return { from: date, to: date };
    if (period === "week") return { from: format(startOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd"), to: format(endOfWeek(d, { weekStartsOn: 1 }), "yyyy-MM-dd") };
    if (period === "month") return { from: format(startOfMonth(d), "yyyy-MM-dd"), to: format(endOfMonth(d), "yyyy-MM-dd") };
    if (period === "quarter") return { from: format(startOfQuarter(d), "yyyy-MM-dd"), to: format(endOfQuarter(d), "yyyy-MM-dd") };
    if (period === "year") return { from: format(startOfYear(d), "yyyy-MM-dd"), to: format(endOfYear(d), "yyyy-MM-dd") };
    // custom
    const from = date <= endDate ? date : endDate;
    const to = date <= endDate ? endDate : date;
    return { from, to };
  }, [date, endDate, period]);

  const { data: lines = [] } = useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const { data } = await supabase.from("lines").select("name").order("name");
      return (data ?? []) as { name: string }[];
    },
  });

  const { data: leaders = [] } = useQuery({
    queryKey: ["line_leaders_active"],
    queryFn: async () => {
      const { data } = await supabase.from("line_leaders").select("name").eq("active", true).order("name");
      return (data ?? []) as { name: string }[];
    },
  });

  const { data: skus = [] } = useQuery({
    queryKey: ["sku_products_min"],
    queryFn: async () => {
      // Paginate past the ~1000-row PostgREST cap so SKUs beyond 1000 resolve.
      const pageSize = 1000;
      const rows: { id: string; code: string; name: string }[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data } = await supabase.from("sku_products").select("id, code, name").order("code").range(offset, offset + pageSize - 1);
        const page = (data ?? []) as { id: string; code: string; name: string }[];
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows;
    },
  });
  const skuMap = useMemo(() => new Map(skus.map((s) => [s.id, s])), [skus]);

  type RagRow = { entry_date: string; line: string; shift: string; plan_qty: number; actual_qty: number };

  const { data: queryResult } = useQuery<{ sessions: SessionAgg[]; ragRows: RagRow[] }>({
    queryKey: ["oee", range.from, range.to, shift, lineFilter, leaderFilter],
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      let q = supabase.from("production_sessions")
        .select("id, session_date, shift, line, leader_name, locked, production_items(sku_id, target_qty, planned_qty, actual_qty)")
        .gte("session_date", range.from).lte("session_date", range.to);
      if (shift !== "all") q = q.eq("shift", shift);
      if (lineFilter !== "__all__") q = q.eq("line", lineFilter);
      if (leaderFilter !== "__all__") q = q.eq("leader_name", leaderFilter);

      // Target comes from RAG Weekly (plan_qty), NOT from SKU per-item targets.
      let rq = supabase.from("rag_weekly_entries")
        .select("entry_date, line, shift, plan_qty, actual_qty")
        .gte("entry_date", range.from).lte("entry_date", range.to);
      if (shift !== "all") rq = rq.eq("shift", shift);
      if (lineFilter !== "__all__") rq = rq.eq("line", lineFilter);

      const [{ data, error }, { data: ragData, error: ragErr }] = await Promise.all([q, rq]);
      if (error) throw error;
      if (ragErr) throw ragErr;

      const ragRows: RagRow[] = ((ragData ?? []) as { entry_date: string; line: string; shift: string; plan_qty: number | null; actual_qty: number | null }[])
        .map((r) => ({ entry_date: r.entry_date, line: r.line, shift: r.shift, plan_qty: Number(r.plan_qty ?? 0), actual_qty: Number(r.actual_qty ?? 0) }));

      const ragPlanMap = new Map<string, number>();
      const ragActualMap = new Map<string, number>();
      for (const r of ragRows) {
        const k = `${r.entry_date}|${r.line}|${r.shift}`;
        ragPlanMap.set(k, r.plan_qty);
        ragActualMap.set(k, r.actual_qty);
      }

      const sessions: SessionAgg[] = (data ?? []).map((s: { id: string; session_date: string; shift: string; line: string; leader_name: string | null; locked: boolean; production_items: { sku_id: string; target_qty: number | null; planned_qty: number | null; actual_qty: number | null }[] }) => {
        const items = s.production_items ?? [];
        const key = `${s.session_date}|${s.line}|${s.shift}`;
        const target = ragPlanMap.get(key) ?? 0;
        const itemsActual = items.reduce((a, i) => a + Number(i.actual_qty ?? 0), 0);
        const ragActual = ragActualMap.get(key) ?? 0;
        const actual = ragActual > 0 ? ragActual : itemsActual;
        return { id: s.id, session_date: s.session_date, shift: s.shift, line: s.line, leader_name: s.leader_name, locked: s.locked, target, actual, eff: target > 0 ? (actual / target) * 100 : 0, items: items.map((i) => ({ sku_id: i.sku_id, actual: Number(i.actual_qty ?? 0) })) };
      });

      return { sessions, ragRows };
    },
  });

  const sessions = useMemo(() => queryResult?.sessions ?? [], [queryResult]);
  const ragRows = useMemo(() => queryResult?.ragRows ?? [], [queryResult]);

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

  // Build byLine from the UNION of RAG Weekly plan rows and production_sessions,
  // so lines with a plan but no session yet still appear (Actual = 0).
  // When leaderFilter is active, RAG-only lines are excluded (RAG has no leader info).
  const byLine = useMemo(() => {
    type Agg = { line: string; target: number; ragActual: number; sessionActual: number; leader: string | null; hasSession: boolean; ragLines: Set<string> };
    const map = new Map<string, Agg>();
    const ragLineSet = new Set<string>();

    if (leaderFilter === "__all__") {
      for (const r of ragRows) {
        ragLineSet.add(r.line);
        const cur = map.get(r.line) ?? { line: r.line, target: 0, ragActual: 0, sessionActual: 0, leader: null, hasSession: false, ragLines: ragLineSet };
        cur.target += r.plan_qty;
        cur.ragActual += r.actual_qty;
        map.set(r.line, cur);
      }
    }

    for (const s of sessions) {
      const cur = map.get(s.line) ?? { line: s.line, target: 0, ragActual: 0, sessionActual: 0, leader: null, hasSession: false, ragLines: ragLineSet };
      // Only add session target if this line wasn't already seeded from RAG (avoid double count).
      if (!ragLineSet.has(s.line)) cur.target += s.target;
      const itemsActual = s.items.reduce((a, i) => a + i.actual, 0);
      cur.sessionActual += itemsActual;
      cur.leader = s.leader_name ?? cur.leader;
      cur.hasSession = true;
      map.set(s.line, cur);
    }

    return Array.from(map.values()).map((x) => {
      const actual = x.ragActual > 0 ? x.ragActual : x.sessionActual;
      return { line: x.line, target: x.target, actual, leader: x.leader, hasSession: x.hasSession, eff: x.target > 0 ? (actual / x.target) * 100 : 0 };
    })
      // Hide empty placeholder lines: no RAG target AND no production (e.g. a session
      // created just by assigning a leader, or an operator opening My Production).
      .filter((x) => x.target > 0 || x.actual > 0)
      .sort((a, b) => b.eff - a.eff);
  }, [sessions, ragRows, leaderFilter]);

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
        <div className="space-y-3">
          <h1 className="text-xl md:text-2xl font-bold">Production Performance</h1>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="shrink-0" onClick={() => {
                if (period === "custom") {
                  const from = parseISO(date), to = parseISO(endDate);
                  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
                  setDate(format(subDays(from, days), "yyyy-MM-dd"));
                  setEndDate(format(subDays(to, days), "yyyy-MM-dd"));
                  return;
                }
                const d = parseISO(date);
                const step = period === "week" ? subDays(d, 7) : period === "month" ? addMonths(d, -1) : period === "quarter" ? addQuarters(d, -1) : period === "year" ? addYears(d, -1) : subDays(d, 1);
                setDate(format(step, "yyyy-MM-dd"));
              }}><ChevronLeft className="h-4 w-4" /></Button>
              <Input type="date" value={date} onChange={(e) => {
                setDate(e.target.value);
                if (period !== "custom") { setPeriod("custom"); if (endDate < e.target.value) setEndDate(e.target.value); }
              }} className="flex-1 sm:w-40 sm:flex-none min-w-0" />
              <span className="text-xs text-muted-foreground shrink-0">to</span>
              <Input type="date" value={endDate} min={date} onChange={(e) => {
                setEndDate(e.target.value);
                if (period !== "custom") setPeriod("custom");
              }} className="flex-1 sm:w-40 sm:flex-none min-w-0" />
              <Button variant="outline" size="icon" className="shrink-0" onClick={() => {
                if (period === "custom") {
                  const from = parseISO(date), to = parseISO(endDate);
                  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);
                  setDate(format(addDays(from, days), "yyyy-MM-dd"));
                  setEndDate(format(addDays(to, days), "yyyy-MM-dd"));
                  return;
                }
                const d = parseISO(date);
                const step = period === "week" ? addDays(d, 7) : period === "month" ? addMonths(d, 1) : period === "quarter" ? addQuarters(d, 1) : period === "year" ? addYears(d, 1) : addDays(d, 1);
                setDate(format(step, "yyyy-MM-dd"));
              }}><ChevronRight className="h-4 w-4" /></Button>
            </div>
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
              <Select value={period} onValueChange={(v) => {
                const p = v as Period;
                if (p === "custom" && endDate < date) setEndDate(date);
                if (p !== "custom") setEndDate(date);
                setPeriod(p);
              }}>
                <SelectTrigger className="w-full sm:w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                  <SelectItem value="quarter">Quarter</SelectItem>
                  <SelectItem value="year">Year</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
              <Select value={shift} onValueChange={(v) => setShift(v as "all" | "DAY" | "NIGHT")}>
                <SelectTrigger className="w-full sm:w-28"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All</SelectItem><SelectItem value="DAY">Day</SelectItem><SelectItem value="NIGHT">Night</SelectItem></SelectContent>
              </Select>
              <Select value={lineFilter} onValueChange={setLineFilter}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All lines</SelectItem>
                  {sortedLines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={leaderFilter} onValueChange={setLeaderFilter}>
                <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="All leaders" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All leaders</SelectItem>
                  {leaders.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap sm:ml-auto">
              {range.from === range.to ? format(parseISO(range.from), "dd MMM yyyy") : `${format(parseISO(range.from), "dd MMM")} → ${format(parseISO(range.to), "dd MMM yyyy")}`}
            </span>
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
                  <div className="text-2xl font-bold">{totalActual.toLocaleString("en-US")} / {totalTarget.toLocaleString("en-US")}</div>
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
        {sortedByLine.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={BarChart3}
                title="No production data for this period"
                description="No line sessions match the current filters. Try adjusting the date range, shift or line filter."
              />
            </CardContent>
          </Card>
        ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedByLine.map((l) => {

            const headerBg = l.eff >= 100 ? "bg-green-500/15" : l.eff >= 80 ? "bg-amber-500/15" : "bg-red-500/15";
            const headerText = l.eff >= 100 ? "text-green-600 dark:text-green-400" : l.eff >= 80 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
            const handleClick = () => navigate("/dashboard/shift-history");
            const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleClick();
              }
            };
            return (
              <Card
                key={l.line}
                role="button"
                tabIndex={0}
                onClick={handleClick}
                onKeyDown={handleKeyDown}
                className={`overflow-hidden border-l-4 cursor-pointer hover:shadow-md hover:border-primary/50 transition-colors transition-shadow ${ragColor(l.eff)}`}
              >
                <div className={`${headerBg} ${headerText} px-4 py-2 flex items-center justify-between gap-2`}>
                  <div className="font-semibold truncate">{l.line}</div>
                  <div
                    className="shrink-0"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <Select
                      value={l.leader ?? "__none__"}
                      disabled={savingLeaderFor === l.line}
                      onValueChange={(v) => {
                        if (v === "__new__") {
                          setAddingLeaderFor(l.line);
                          setNewLeaderName("");
                        } else {
                          setLeaderForLine(l.line, v === "__none__" ? null : v, l.hasSession);
                        }
                      }}
                    >
                      <SelectTrigger className="h-7 w-36 text-xs bg-background/60">
                        <SelectValue placeholder="— None —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {/* Keep the assigned leader selectable even if deactivated/renamed. */}
                        {l.leader && !leaders.some((ld) => ld.name === l.leader) && (
                          <SelectItem value={l.leader}>{l.leader} (inactive)</SelectItem>
                        )}
                        {leaders.map((ld) => (
                          <SelectItem key={ld.name} value={ld.name}>{ld.name}</SelectItem>
                        ))}
                        <SelectItem value="__new__">+ Add new leader…</SelectItem>
                      </SelectContent>
                    </Select>
                    {addingLeaderFor === l.line && (
                      <div className="flex items-center gap-1 mt-1">
                        <Input
                          autoFocus
                          value={newLeaderName}
                          onChange={(e) => setNewLeaderName(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") addNewLeader(l.line, l.hasSession);
                            if (e.key === "Escape") { setAddingLeaderFor(null); setNewLeaderName(""); }
                          }}
                          placeholder="Leader name"
                          className="h-7 w-36 text-xs"
                        />
                        <Button
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={savingLeaderFor === l.line || !newLeaderName.trim()}
                          onClick={() => addNewLeader(l.line, l.hasSession)}
                        >
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => { setAddingLeaderFor(null); setNewLeaderName(""); }}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                <CardContent className="p-4 flex items-center gap-4">
                  <CircularProgress value={l.eff} size={88} strokeWidth={8} />
                  <div className="flex-1 text-sm space-y-0.5">
                    <div className="flex justify-between"><span className="text-muted-foreground">Target</span><span className="font-medium">{l.target.toLocaleString("en-US")}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Actual</span><span className="font-medium">{l.actual.toLocaleString("en-US")}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Gap</span><span className={`font-medium ${l.actual - l.target >= 0 ? "text-green-500" : "text-red-500"}`}>{(l.actual - l.target).toLocaleString("en-US")}</span></div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        )}
      </div>
    </DashboardLayout>

  );
}
