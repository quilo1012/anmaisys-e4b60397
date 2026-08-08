import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { usePmSchedules, useUpdatePmSchedule } from "@/hooks/usePreventiveMaintenance";
import { toast } from "sonner";
import { Brain, CheckCircle2, AlertTriangle, ArrowDown, ArrowUp, ArrowLeft, Printer } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { KpiCard } from "@/components/reports/KpiCard";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { printElementAsDocument } from "@/lib/printDocument";
import { PreventiveOpportunities } from "@/components/PreventiveOpportunities";

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
  /** The row is a production line, not a machine — see the note in `stats`. */
  isLine: boolean;
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
  reduce: { label: "Reduce interval", cls: "bg-destructive/15 text-destructive-strong border-destructive/30 dark:text-destructive-strong", icon: ArrowDown },
  no_pm: { label: "No PM scheduled", cls: "bg-warning/15 text-warning-strong border-warning/30 dark:text-warning-strong", icon: AlertTriangle },
  ok: { label: "OK — calibrated", cls: "bg-primary/15 text-primary border-primary/30 dark:text-primary", icon: CheckCircle2 },
  increase: { label: "Can extend", cls: "bg-success/15 text-success-strong border-success/30 dark:text-success-strong", icon: ArrowUp },
};

export default function PMIntelligencePage() {
  const navigate = useNavigate();
  // Ranged, not the default query.
  //
  // useWorkOrders() with no range returns the 200 most recent orders — right for a
  // worklist, wrong for this page. There are 317 orders in the last 90 days, so the
  // page was computing MTBF, MTTR and every interval recommendation from 200 of them
  // and silently dropping 117 — the OLDEST ones, which is precisely what a mean time
  // BETWEEN failures is measured from. The header said "Last 90 days" and meant about
  // seven weeks.
  const range = useMemo(() => {
    const to = new Date();
    return { from: new Date(to.getTime() - 90 * 24 * 3600 * 1000), to };
  }, []);
  const { data: wos, isLoading: woLoading } = useWorkOrders(range);
  const { data: schedules, isLoading: pmLoading } = usePmSchedules();

  // Most orders record the LINE in the machine field — "Line 4", "Line 6A" — so this
  // page was grouping lines and calling them machines. A line fails every 0.7 days
  // because it is twelve machines; 70% of that is negative, the clamp lifts it to the
  // 7-day floor, and every row printed the same recommendation. Knowing which keys are
  // lines is what lets the table stop pretending.
  const { data: lineNames } = useQuery({
    queryKey: ["pm_line_names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lines").select("name");
      if (error) throw error;
      return new Set((data ?? []).map((l: { name: string }) => l.name.trim().toLowerCase()));
    },
  });
  const updatePm = useUpdatePmSchedule();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const stats = useMemo<MachineStats[]>(() => {
    if (!wos) return [];
    const since = range.from.getTime();
    const byMachine = new Map<string, typeof wos>();
    for (const w of wos) {
      if (!w.machine) continue;
      // Planned work is not a failure. Counting it would drag a machine's MTBF down
      // for being looked after, and recommend a shorter interval because the last
      // recommendation was followed.
      if ((w.wo_type as string) === "preventive") continue;
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
        isLine: !!lineNames?.has(machine.trim().toLowerCase()),
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
  }, [wos, schedules, range, lineNames]);

  /**
   * What the numbers are made of, said out loud.
   *
   * Roughly half the orders in this window carry no machine, and this page groups by
   * machine — so they are skipped. That is fine; pretending it did not happen is not.
   * An interval recommendation drawn from a third of the evidence should say so.
   */
  const coverage = useMemo(() => {
    const rows = wos ?? [];
    const inRange = rows.filter((w) => new Date(w.created_at).getTime() >= range.from.getTime());
    const named = inRange.filter((w) => !!w.machine);
    const timed = named.filter((w) => w.started_at && w.finished_at);
    return { total: inRange.length, named: named.length, timed: timed.length };
  }, [wos, range]);

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

  const counts = useMemo(() => ({
    reduce: stats.filter((s) => s.rec === "reduce").length,
    no_pm: stats.filter((s) => s.rec === "no_pm").length,
    ok: stats.filter((s) => s.rec === "ok").length,
    increase: stats.filter((s) => s.rec === "increase").length,
  }), [stats]);

  return (
    <DashboardLayout>
      <div id="pm-intelligence-print" className="space-y-6 print-content">
        <ReportPrintHeader
          title="PM Intelligence"
          periodLabel="Last 90 days"
          filtersLabel="Recommended PM interval ≈ 70% of measured MTBF"
        />

        <PageHeader
          className="print:hidden"
          title="PM Intelligence"
          description="Compares real MTBF and MTTR per machine against the current PM interval and recommends an adjustment."
          icon={<Brain className="h-5 w-5" />}
          actions={
            <Button variant="outline" size="sm" className="gap-2" onClick={async () => {
              const el = document.getElementById("pm-intelligence-print");
              try {
                // Landscape: nine columns and a machine name per row do not fit A4 portrait,
                // and on paper a table cannot scroll — it just loses the right-hand columns.
                if (el) await printElementAsDocument(el, "PM Intelligence", { landscape: true });
              } catch (err: any) {
                toast.error(err?.message ?? "Could not open the print dialog.");
              }
            }}>
              <Printer className="h-4 w-4" /> Print
            </Button>
          }
        />

        {/* What the table concludes, before the table itself — the reason to open this
            screen is "does anything need changing", and that was only answerable by
            reading 30 rows. Each tile is also the count for its badge below. */}
        {!isLoading && stats.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 print:grid-cols-4 print:gap-2">
            <KpiCard label="Service too late" value={counts.reduce} sublabel="PM falls after the average failure" toneValue accent="danger" />
            <KpiCard label="No PM scheduled" value={counts.no_pm} sublabel="Failing with nothing planned" toneValue accent="warning" />
            <KpiCard label="Calibrated" value={counts.ok} sublabel="Interval matches the evidence" toneValue accent="info" />
            <KpiCard label="Can extend" value={counts.increase} sublabel="Serviced more often than needed" toneValue accent="ok" />
          </div>
        )}

        {!isLoading && coverage.total > 0 && (
          <p className="text-2xs text-muted-foreground">
            Read from {coverage.named} of {coverage.total} orders in the last 90 days — the rest name no
            machine, and this page groups by machine. Repair times come from the {coverage.timed} that
            carry both a start and a finish. Rows marked <b>line</b> were recorded against a production
            line rather than a machine, so no service interval is derived from them.
          </p>
        )}

        {isLoading ? <Skeleton className="h-40" /> : <PreventiveOpportunities workOrders={wos} />}

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
                    <th className="p-2 text-right print:hidden">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-muted-foreground">
                        No maintenance orders in the last 90 days.
                      </td>
                    </tr>
                  )}
                  {stats.map((s) => {
                    const meta = recMeta[s.rec];
                    const Icon = meta.icon;
                    const canApply = !s.isLine && !!s.scheduleId && !!s.recommended && s.recommended !== s.currentInterval;
                    return (
                      <tr key={s.machine} className="border-b last:border-0 align-top">
                        <td className="p-2 font-medium">
                          {s.machine}
                          {s.isLine && (
                            <Badge variant="outline" className="ml-1.5 text-[9px] leading-4 text-muted-foreground">
                              line
                            </Badge>
                          )}
                        </td>
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
                        {/* A line is not a machine. Its orders are the sum of a dozen
                            machines, so the interval between them says nothing about
                            when any one of them should be serviced — and the clamp
                            turned every one of those rows into the same "7d". */}
                        <td className="p-2 text-right tabular-nums font-semibold">
                          {s.isLine
                            ? <span className="font-normal text-muted-foreground" title="Recorded against a line, not a machine">n/a</span>
                            : s.recommended !== null ? `${s.recommended}d` : "—"}
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
                        <td className="p-2 text-right print:hidden">
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

        <div className="print-doc-footer hidden print:flex items-center justify-between mt-4 pt-2 border-t border-black text-[8pt]">
          <span>{stats.length} machine{stats.length === 1 ? "" : "s"} with maintenance orders in the last 90 days</span>
          <span>Applied Nutrition · Confidential</span>
        </div>
      </div>
    </DashboardLayout>
  );
}
