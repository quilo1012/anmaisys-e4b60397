import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Clock, Factory } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { QUALITY_SEVERITIES, severityMeta } from "@/lib/qualityConstants";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface LSAction { id: string; status: string; severity: string | null; recorded_at: string; labels: string[] | null; department: string | null; line: string | null }
interface LSSession { oee_pct: number | null; run_time_min: number | null; down_time_min: number | null; intouch_good_total: number | null; session_date: string | null }

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-bold", tone)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </CardContent></Card>
  );
}

export function LeaderScorecard({ leaderName, fromDate, onClose }: { leaderName: string | null; fromDate: string; onClose: () => void }) {
  const enabled = !!leaderName;

  const { data: actions = [] } = useQuery({
    queryKey: ["ls_actions", leaderName, fromDate],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("quality_actions")
        .select("id, status, severity, recorded_at, labels, department, line")
        .eq("leader_name", leaderName as string).gte("recorded_at", fromDate).order("recorded_at");
      if (error) throw error;
      return (data ?? []) as unknown as LSAction[];
    },
  });

  const actionIds = useMemo(() => actions.map((a) => a.id), [actions]);
  const { data: completes = [] } = useQuery({
    queryKey: ["ls_hist", leaderName, fromDate, actionIds.length],
    enabled: enabled && actionIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
        .from("quality_action_history" as any)
        .select("action_id, changed_at, new_value, field")
        .in("action_id", actionIds).eq("field", "status").eq("new_value", "complete");
      if (error) throw error;
      return (data ?? []) as unknown as { action_id: string; changed_at: string }[];
    },
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["ls_prod", leaderName, fromDate],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("production_sessions")
        .select("oee_pct, run_time_min, down_time_min, intouch_good_total, session_date")
        .eq("leader_name", leaderName as string).gte("session_date", fromDate);
      if (error) throw error;
      return (data ?? []) as unknown as LSSession[];
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["ls_items", leaderName, fromDate],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("production_items")
        .select("actual_qty, target_qty, production_sessions!inner(leader_name, session_date)")
        .eq("production_sessions.leader_name", leaderName as string)
        .gte("production_sessions.session_date", fromDate);
      if (error) return [] as { actual_qty: number | null; target_qty: number | null }[];
      return (data ?? []) as unknown as { actual_qty: number | null; target_qty: number | null }[];
    },
  });

  const q = useMemo(() => {
    const total = actions.length;
    const completed = actions.filter((a) => a.status === "complete").length;
    const open = total - completed;
    const sev = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
    for (const a of actions) if (a.severity && sev[a.severity] !== undefined) sev[a.severity] += 1;
    const completeAt = new Map<string, number>();
    for (const c of completes) {
      const t = new Date(c.changed_at).getTime();
      const prev = completeAt.get(c.action_id);
      if (prev === undefined || t > prev) completeAt.set(c.action_id, t);
    }
    let sumDays = 0, n = 0;
    for (const a of actions) {
      const done = completeAt.get(a.id);
      if (a.status === "complete" && done) { sumDays += (done - new Date(a.recorded_at).getTime()) / 86400000; n += 1; }
    }
    const avgResolution = n > 0 ? sumDays / n : null;
    const labelMap = new Map<string, number>();
    for (const a of actions) for (const l of a.labels ?? []) labelMap.set(l, (labelMap.get(l) ?? 0) + 1);
    const topLabels = Array.from(labelMap.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6);
    const dayMap = new Map<string, number>();
    for (const a of actions) { const k = format(new Date(a.recorded_at), "yyyy-MM-dd"); dayMap.set(k, (dayMap.get(k) ?? 0) + 1); }
    const trend = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([k, count]) => ({ day: format(new Date(k + "T00:00:00"), "dd/MM"), count }));
    return { total, completed, open, pctClosed: total ? Math.round((completed / total) * 100) : 0, sev, avgResolution, topLabels, trend };
  }, [actions, completes]);

  const p = useMemo(() => {
    const oees = sessions.map((s) => s.oee_pct).filter((v): v is number => v != null);
    const avgOEE = oees.length ? oees.reduce((a, b) => a + b, 0) / oees.length : null;
    const downtimeH = sessions.reduce((s, x) => s + (x.down_time_min ?? 0), 0) / 60;
    const runtimeH = sessions.reduce((s, x) => s + (x.run_time_min ?? 0), 0) / 60;
    const output = sessions.reduce((s, x) => s + (x.intouch_good_total ?? 0), 0);
    const actual = items.reduce((s, x) => s + (x.actual_qty ?? 0), 0);
    const target = items.reduce((s, x) => s + (x.target_qty ?? 0), 0);
    const attainment = target > 0 ? Math.round((actual / target) * 100) : null;
    return { sessions: sessions.length, avgOEE, downtimeH, runtimeH, output, attainment };
  }, [sessions, items]);

  const exportCSV = () => {
    const rows: string[][] = [
      ["Leader", leaderName ?? ""],
      ["Period from", fromDate],
      [],
      ["QUALITY"],
      ["Total actions", String(q.total)], ["Open", String(q.open)], ["Completed", String(q.completed)], ["% closed", `${q.pctClosed}%`],
      ["Avg resolution (days)", q.avgResolution == null ? "—" : q.avgResolution.toFixed(1)],
      ["Critical", String(q.sev.critical)], ["High", String(q.sev.high)], ["Medium", String(q.sev.medium)], ["Low", String(q.sev.low)],
      [],
      ["PRODUCTION"],
      ["Sessions", String(p.sessions)], ["Avg OEE", p.avgOEE == null ? "—" : `${p.avgOEE.toFixed(1)}%`],
      ["Output (good)", String(p.output)], ["Attainment", p.attainment == null ? "—" : `${p.attainment}%`],
      ["Downtime (h)", p.downtimeH.toFixed(1)], ["Run time (h)", p.runtimeH.toFixed(1)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `leader-${(leaderName ?? "x").replace(/\s+/g, "_")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={!!leaderName} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 pr-6">
            <span>{leaderName}</span>
            <Button size="sm" variant="outline" onClick={exportCSV}><Download className="mr-1 h-4 w-4" />Export</Button>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Quality */}
          <div>
            <div className="mb-1.5 flex items-center gap-1 text-sm font-semibold"><Clock className="h-4 w-4" /> Quality</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="Total actions" value={q.total} />
              <Kpi label="Open" value={q.open} tone="text-amber-600 dark:text-amber-400" />
              <Kpi label="% closed" value={`${q.pctClosed}%`} tone="text-green-600 dark:text-green-400" sub={`${q.completed} completed`} />
              <Kpi label="Avg resolution" value={q.avgResolution == null ? "—" : `${q.avgResolution.toFixed(1)}d`} sub="created → complete" />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUALITY_SEVERITIES.slice().reverse().map((s) => (
                <Badge key={s.value} variant="outline" className={cn("text-[10px]", severityMeta(s.value)?.badge)}>{s.label}: {q.sev[s.value] ?? 0}</Badge>
              ))}
            </div>
          </div>

          {q.trend.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Actions over time</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={q.trend} margin={{ top: 4, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" fontSize={11} tickLine={false} />
                    <YAxis allowDecimals={false} fontSize={11} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="count" name="Actions" stroke="hsl(0 72% 51%)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {q.topLabels.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Top labels</div>
              <div className="flex flex-wrap gap-1.5">
                {q.topLabels.map((l) => <Badge key={l.label} variant="secondary" className="text-[10px]">{l.label} · {l.count}</Badge>)}
              </div>
            </div>
          )}

          {/* Production */}
          <div>
            <div className="mb-1.5 flex items-center gap-1 text-sm font-semibold"><Factory className="h-4 w-4" /> Production <span className="text-xs font-normal text-muted-foreground">({p.sessions} sessions)</span></div>
            {p.sessions === 0 ? (
              <p className="text-xs text-muted-foreground">No production sessions for this leader in the period.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Kpi label="Avg OEE" value={p.avgOEE == null ? "—" : `${p.avgOEE.toFixed(1)}%`} tone="text-blue-600 dark:text-blue-400" />
                <Kpi label="Attainment" value={p.attainment == null ? "—" : `${p.attainment}%`} sub="actual vs target" />
                <Kpi label="Output (good)" value={p.output.toLocaleString()} />
                <Kpi label="Downtime" value={`${p.downtimeH.toFixed(1)}h`} tone="text-red-600 dark:text-red-400" />
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
