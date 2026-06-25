import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
}

export default function ProductionPerformancePage() {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [period, setPeriod] = useState<Period>("day");
  const [shift, setShift] = useState<"all" | "DAY" | "NIGHT">("all");
  const [lineFilter, setLineFilter] = useState<string>("__all__");

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

  const { data: sessions = [] } = useQuery<SessionAgg[]>({
    queryKey: ["oee", range.from, range.to, shift, lineFilter],
    queryFn: async () => {
      let q = supabase.from("production_sessions")
        .select("id, session_date, shift, line, leader_name, locked, production_items(target_qty, planned_qty, actual_qty)")
        .gte("session_date", range.from).lte("session_date", range.to);
      if (shift !== "all") q = q.eq("shift", shift);
      if (lineFilter !== "__all__") q = q.eq("line", lineFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((s: { id: string; session_date: string; shift: string; line: string; leader_name: string | null; locked: boolean; production_items: { target_qty: number | null; planned_qty: number | null; actual_qty: number | null }[] }) => {
        const items = s.production_items ?? [];
        const target = items.reduce((a, i) => a + Number(i.target_qty ?? i.planned_qty ?? 0), 0);
        const actual = items.reduce((a, i) => a + Number(i.actual_qty ?? 0), 0);
        return { id: s.id, session_date: s.session_date, shift: s.shift, line: s.line, leader_name: s.leader_name, locked: s.locked, target, actual, eff: target > 0 ? (actual / target) * 100 : 0 };
      });
    },
  });

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
                {lines.map((l) => <SelectItem key={l.name} value={l.name}>{l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
          {byLine.length === 0 && <Card><CardContent className="p-4 text-muted-foreground">No data</CardContent></Card>}
          {byLine.map((l) => (
            <Card key={l.line} className={`border-l-4 ${ragColor(l.eff)}`}>
              <CardContent className="p-4">
                <div className="text-sm font-semibold">{l.line}</div>
                <div className="text-xs text-muted-foreground">{l.leader ?? "—"}</div>
                <div className="text-2xl font-bold mt-1">{l.eff.toFixed(0)}%</div>
                <div className="text-xs text-muted-foreground">{l.actual} / {l.target}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle>Efficiency per line</CardTitle></CardHeader>
          <CardContent style={{ height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={byLine}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="line" />
                <YAxis />
                <Tooltip />
                <ReferenceLine y={100} stroke="hsl(142 76% 36%)" strokeDasharray="3 3" />
                <ReferenceLine y={80} stroke="hsl(38 92% 50%)" strokeDasharray="3 3" />
                <Bar dataKey="eff" fill="hsl(var(--primary))" shape={(props: { x?: number; y?: number; width?: number; height?: number; payload?: { eff: number } }) => {
                  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
                  return <rect x={x} y={y} width={width} height={height} fill={ragFill(payload?.eff ?? 0)} />;
                }} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Trend</CardTitle></CardHeader>
          <CardContent style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="eff" stroke="hsl(var(--primary))" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Medal className="h-5 w-5" />Leaderboard (Top 10)</CardTitle></CardHeader>
          <CardContent>
            <div className="divide-y">
              {leaderboard.length === 0 && <div className="text-muted-foreground py-4">No leaders</div>}
              {leaderboard.map((l, i) => (
                <div key={l.leader} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg w-6">{medal(i) ?? `#${i + 1}`}</span>
                    <span className="font-medium">{l.leader}</span>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">{l.sessions} sessions</span>
                    <span className="text-muted-foreground">{l.actual} units</span>
                    <span className="font-bold">{l.eff.toFixed(0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
