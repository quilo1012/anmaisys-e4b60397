import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { usePmSchedules, useUpdatePmSchedule } from "@/hooks/usePreventiveMaintenance";
import { toast } from "sonner";
import { Brain, CheckCircle2, AlertTriangle, ArrowDown, ArrowUp, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

type RecKind = "reduce" | "no_pm" | "ok" | "increase";

interface MachineStats {
  machine: string;
  failures: number;
  mtbfDays: number | null; // average days between failures
  mttrHours: number | null; // average hours to repair
  currentInterval: number | null; // PM interval_days
  scheduleId: string | null;
  recommended: number | null; // recommended interval_days
  rec: RecKind;
  topIssues: { description: string; count: number }[];
}

function classifyRecommendation(
  mtbfDays: number | null,
  failures: number,
  currentInterval: number | null,
): { rec: RecKind; recommended: number | null } {
  if (failures < 2 || mtbfDays === null) {
    if (currentInterval === null) return { rec: "no_pm", recommended: null };
    return { rec: "ok", recommended: currentInterval };
  }
  // Recommended PM = ~70% of MTBF, clamped to 7..180 days
  const recommended = Math.max(7, Math.min(180, Math.round(mtbfDays * 0.7)));
  if (currentInterval === null) return { rec: "no_pm", recommended };
  // Reduce: PM happens long AFTER average failure (current > 1.3 * MTBF)
  if (currentInterval > mtbfDays * 1.3) return { rec: "reduce", recommended };
  // Increase: PM way more frequent than needed (current < 0.4 * MTBF)
  if (currentInterval < mtbfDays * 0.4) return { rec: "increase", recommended };
  return { rec: "ok", recommended: currentInterval };
}

const recMeta: Record<RecKind, { label: string; cls: string; icon: any }> = {
  reduce: { label: "Reduce interval", cls: "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300", icon: ArrowDown },
  no_pm: { label: "No PM scheduled", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300", icon: AlertTriangle },
  ok: { label: "OK — calibrated", cls: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300", icon: CheckCircle2 },
  increase: { label: "Can extend", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300", icon: ArrowUp },
};

export default function PMIntelligencePage() {
  const { data: wos, isLoading: woLoading } = useWorkOrders();
  const { data: schedules, isLoading: pmLoading } = usePmSchedules();
  const updatePm = useUpdatePmSchedule();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const stats = useMemo<MachineStats[]>(() => {
    if (!wos) return [];
    const since = Date.now() - 90 * 24 * 3600 * 1000;
    const byMachine = new Map<string, typeof wos>();
    for (const w of wos) {
      if (!w.machine) continue;
      if (new Date(w.created_at).getTime() < since) continue;
      const arr = byMachine.get(w.machine) ?? [];
      arr.push(w);
      byMachine.set(w.machine, arr);
    }
    const pmByMachine = new Map<string, { id: string; interval: number }>();
    for (const s of schedules ?? []) {
      if (!s.machine) continue;
      const cur = pmByMachine.get(s.machine);
      // Keep the active schedule with shortest interval as "current"
      if (!cur || (s.active && s.interval_days < cur.interval)) {
        pmByMachine.set(s.machine, { id: s.id, interval: s.interval_days });
      }
    }

    const out: MachineStats[] = [];
    byMachine.forEach((rows, machine) => {
      const sorted = [...rows].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
      const failures = sorted.length;
      let mtbfDays: number | null = null;
      if (failures >= 2) {
        const first = new Date(sorted[0].created_at).getTime();
        const last = new Date(sorted[failures - 1].created_at).getTime();
        const spanDays = (last - first) / 86_400_000;
        mtbfDays = spanDays / (failures - 1);
      }
      const repairs = sorted
        .filter((w) => w.started_at && w.finished_at)
        .map(
          (w) =>
            (new Date(w.finished_at!).getTime() - new Date(w.started_at!).getTime()) / 3_600_000,
        )
        .filter((h) => h > 0 && h < 72);
      const mttrHours = repairs.length
        ? repairs.reduce((a, b) => a + b, 0) / repairs.length
        : null;

      const issuesMap = new Map<string, number>();
      for (const w of sorted) {
        const key = (w.description || "—").trim().slice(0, 80);
        issuesMap.set(key, (issuesMap.get(key) ?? 0) + 1);
      }
      const topIssues = Array.from(issuesMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([description, count]) => ({ description, count }));

      const pm = pmByMachine.get(machine);
      const currentInterval = pm?.interval ?? null;
      const { rec, recommended } = classifyRecommendation(mtbfDays, failures, currentInterval);

      out.push({
        machine,
        failures,
        mtbfDays,
        mttrHours,
        currentInterval,
        scheduleId: pm?.id ?? null,
        recommended,
        rec,
        topIssues,
      });
    });

    return out.sort((a, b) => {
      const order: Record<RecKind, number> = { reduce: 0, no_pm: 1, ok: 2, increase: 3 };
      if (order[a.rec] !== order[b.rec]) return order[a.rec] - order[b.rec];
      return b.failures - a.failures;
    });
  }, [wos, schedules]);

  const isLoading = woLoading || pmLoading;

  const handleApply = async (s: MachineStats) => {
    if (!s.scheduleId || !s.recommended) return;
    setApplyingId(s.scheduleId);
    try {
      await updatePm.mutateAsync({ id: s.scheduleId, interval_days: s.recommended });
      toast.success(`PM interval for ${s.machine} updated to ${s.recommended} days`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to update PM");
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-start gap-3">
          <Brain className="h-7 w-7 text-primary mt-1" />
          <div>
            <h1 className="text-2xl font-bold">PM Intelligence</h1>
            <p className="text-sm text-muted-foreground">
              Analyzes the last 90 days of work orders by machine, compares real MTBF/MTTR to the
              current PM interval, and recommends adjustments.
            </p>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-96" />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Recommendations</CardTitle>
              <CardDescription>
                Recommended PM interval ≈ 70% of measured MTBF. Click Apply to update the schedule.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="p-2">Machine</th>
                    <th className="p-2 text-right">Failures (90d)</th>
                    <th className="p-2 text-right">MTBF</th>
                    <th className="p-2 text-right">MTTR</th>
                    <th className="p-2 text-right">Current PM</th>
                    <th className="p-2 text-right">Recommended</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Top issues</th>
                    <th className="p-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-muted-foreground">
                        No work orders in the last 90 days.
                      </td>
                    </tr>
                  )}
                  {stats.map((s) => {
                    const meta = recMeta[s.rec];
                    const Icon = meta.icon;
                    const canApply = !!s.scheduleId && !!s.recommended && s.recommended !== s.currentInterval;
                    return (
                      <tr key={s.machine} className="border-b last:border-0 align-top">
                        <td className="p-2 font-medium">{s.machine}</td>
                        <td className="p-2 text-right tabular-nums">{s.failures}</td>
                        <td className="p-2 text-right tabular-nums">
                          {s.mtbfDays !== null ? `${s.mtbfDays.toFixed(1)}d` : "—"}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {s.mttrHours !== null ? `${s.mttrHours.toFixed(1)}h` : "—"}
                        </td>
                        <td className="p-2 text-right tabular-nums">
                          {s.currentInterval !== null ? `${s.currentInterval}d` : <span className="text-muted-foreground">none</span>}
                        </td>
                        <td className="p-2 text-right tabular-nums font-semibold">
                          {s.recommended !== null ? `${s.recommended}d` : "—"}
                        </td>
                        <td className="p-2">
                          <Badge variant="outline" className={`gap-1 ${meta.cls}`}>
                            <Icon className="h-3 w-3" />
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {s.topIssues.length === 0 ? (
                            "—"
                          ) : (
                            <ul className="space-y-0.5">
                              {s.topIssues.map((i, idx) => (
                                <li key={idx} className="truncate max-w-[260px]">
                                  <span className="font-semibold tabular-nums mr-1">{i.count}×</span>
                                  {i.description}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="p-2 text-right">
                          {canApply ? (
                            <Button
                              size="sm"
                              variant={s.rec === "reduce" ? "destructive" : "default"}
                              disabled={applyingId === s.scheduleId}
                              onClick={() => handleApply(s)}
                            >
                              {applyingId === s.scheduleId ? "Applying…" : `Apply ${s.recommended}d`}
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {s.scheduleId ? "—" : "create PM first"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
