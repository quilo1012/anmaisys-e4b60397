import { useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useStandardCycles } from "@/hooks/useStandardCycles";
import { useLineShiftRuns } from "@/hooks/useLineShiftRuns";
import { lineShiftPerformance } from "@/lib/lineShiftPerformance";
import { bayInk } from "@/lib/lineBay";
import { cn } from "@/lib/utils";

const s = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(2)} s`);
const p = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);

export default function LineFillPerformancePage() {
  const [days, setDays] = useState(14);
  const cycles = useStandardCycles();
  const runs = useLineShiftRuns(days);
  const [line, setLine] = useState("all");
  const data = useMemo(
    () => (cycles.raw && runs.data ? lineShiftPerformance(runs.data, cycles.raw.records, cycles.approved) : null),
    [cycles.raw, runs.data, cycles.approved],
  );
  const shown = (data ?? []).filter((l) => line === "all" || l.line === line);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader dense module="Production" title="Line fill performance" description="Approved fill time, iTouch and performance per line, shift by shift." icon={<Activity className="h-5 w-5" />} className="mb-0 border-b pb-3" />
        <div className="flex flex-wrap items-center gap-2">
          {[7, 14, 30].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className={cn("h-12 rounded-lg border px-4 text-sm font-medium", days === d ? "border-primary bg-primary/15 text-primary" : "bg-card hover:bg-muted")}>{d} days</button>
          ))}
          <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
          {["all", ...(data ?? []).map((l) => l.line)].map((l) => (
            <button key={l} type="button" onClick={() => setLine(l)} className={cn("inline-flex h-12 items-center gap-2 rounded-lg border px-4 text-sm font-medium", line === l ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
              {l !== "all" && <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: bayInk(l) }} aria-hidden />}{l === "all" ? "All lines" : l}
            </button>
          ))}
          {!cycles.registerActive && <Badge variant="outline" className="ml-auto">SKU register not active — using iTouch</Badge>}
        </div>
        {cycles.isLoading || runs.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : runs.error || cycles.error ? <p role="alert" className="text-sm text-destructive">Could not load production history or iTouch.</p>
          : !shown.length ? <p className="text-sm text-muted-foreground">No production history with run time in this period.</p>
          : shown.map((l) => (
            <Card key={l.line} style={{ borderTop: `4px solid ${bayInk(l.line)}` }}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle>{l.line}</CardTitle>
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-base">Performance {p(l.performance)}</Badge>
                  {l.uncovered > 0 && <Badge variant="outline">{l.uncovered} runs without a standard</Badge>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={l.shifts}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis unit="%" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} formatter={(v: number) => [`${v}%`, "Performance"]} />
                      <ReferenceLine y={100} stroke="hsl(var(--primary))" strokeDasharray="4 4" />
                      <Bar dataKey="performance" fill={bayInk(l.line)} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="max-h-72 overflow-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card text-xs uppercase tracking-wide text-muted-foreground">
                      <tr><th className="p-2 text-left">SKU</th><th className="p-2 text-right">Approved</th><th className="p-2 text-right">iTouch</th><th className="p-2 text-right">Real / unit</th><th className="p-2 text-right">Performance</th></tr>
                    </thead>
                    <tbody>
                      {l.skus.map((k) => (
                        <tr key={k.sku} className="border-t">
                          <td className="p-2"><div className="font-medium">{k.sku}</div><div className="max-w-[280px] truncate text-xs text-muted-foreground">{k.name}</div></td>
                          <td className="p-2 text-right tabular-nums">{s(k.approvedSeconds)}{k.unitsPerCycle && k.unitsPerCycle > 1 ? <span className="text-xs text-muted-foreground"> /{k.unitsPerCycle}</span> : null}</td>
                          <td className="p-2 text-right tabular-nums">{s(k.itouchSeconds)}</td>
                          <td className="p-2 text-right tabular-nums">{s(k.realSeconds)}</td>
                          <td className={cn("p-2 text-right font-semibold tabular-nums", k.performance != null && k.performance > 100 && "text-primary")}>{p(k.performance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
    </DashboardLayout>
  );
}
