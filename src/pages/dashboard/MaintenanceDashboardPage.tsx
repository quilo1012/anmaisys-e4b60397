import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, startOfDay, startOfWeek } from "date-fns";
import {
  Wrench, ClipboardList, Hand, Loader2, Hourglass, PenTool, PowerOff, CalendarClock, CheckCircle2, Timer,
  RefreshCw, Cog, Search, Clock, FileBarChart, AlertCircle, CalendarCheck,
} from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/reports/KpiCard";
import { DateRangeFilter, getPresetRange, type DateRange, type DateRangePreset } from "@/components/DateRangeFilter";
import { Panel, BarList, AlertList, QuickActions, NotYours, type AlertItem, type Shortcut } from "@/components/dashboards/DashboardParts";
import { useAuth } from "@/contexts/AuthContext";
import { can } from "@/lib/permissions";
import { useMaintenanceProblemAnalysis } from "@/hooks/useMaintenanceProblemAnalysis";
import { useMaintenanceKpis } from "@/hooks/useMaintenanceKpis";
import { usePmSchedules, pmStatus } from "@/hooks/usePreventiveMaintenance";
import { useStoppedLinesCount } from "@/hooks/useStoppedLinesCount";
import { useWoFinishedCount } from "@/hooks/useDepartmentDashboards";
import { computeKpis, groupByProblem, sortGroups, formatHours, STATUS_LABEL } from "@/lib/maintenanceProblemAnalysis";
import { byPriority, byEngineer, byLine, typeSplit, notAccepted, stale, isHighPriority, type DashboardWo } from "@/lib/maintenanceDashboard";
import { woListHref } from "@/lib/woListLink";
import { formatMinutes } from "@/lib/formatDuration";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Maintenance's own dashboard: the orders that are open now, the work done in a
 * period, the problems that cost the most hours, and the preventive work coming due.
 *
 * Two clocks on one page, and each card says which it reads. "Now" figures are every
 * order not finished, whatever day it was raised — an order from last week still
 * waiting is the point. Period figures are orders raised in the period, which is how
 * Problem Analysis and Reliability file them, except "finished" counts, which are
 * filed by when the work was finished.
 *
 * There is no due date on a work order, so "overdue" is said the only way the data
 * can: in progress for more than 72 hours, the orders list's own Stale rule.
 */

const SHORTCUTS: Shortcut[] = [
  { label: "Maintenance Orders", to: "/dashboard/work-orders", icon: ClipboardList, action: "wo.view" },
  { label: "Machines", to: "/dashboard/machines", icon: Cog, action: "machines.view" },
  { label: "Preventive", to: "/dashboard/preventive", icon: CalendarCheck, action: "pm.view" },
  { label: "Problem Analysis", to: "/dashboard/maintenance-analysis", icon: Search, action: "reliability.view" },
  { label: "Downtime", to: "/dashboard/downtime", icon: Clock, action: "downtime.view" },
  { label: "Problems", to: "/dashboard/problems", icon: AlertCircle, action: "problems.view" },
  { label: "Reports", to: "/dashboard/reports", icon: FileBarChart, action: "reports.analytics" },
];

export default function MaintenanceDashboardPage() {
  const { role } = useAuth();
  const qc = useQueryClient();
  const [range, setRange] = useState<DateRange>(() => getPresetRange("30d"));
  const [preset, setPreset] = useState<DateRangePreset>("30d");
  const mayOrders = can(role, "wo.view");
  const mayPm = can(role, "pm.view");

  return (
    <DashboardLayout>
      <PageHeader
        module="Maintenance"
        title="Maintenance Dashboard"
        description="Open orders, the work done, where the hours go, and preventive work coming due."
        icon={<Wrench />}
        actions={
          <Button variant="outline" size="sm" onClick={() => void qc.invalidateQueries()} aria-label="Refresh all figures">
            <RefreshCw className="mr-1 h-4 w-4" /> Refresh
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1 text-xs font-medium text-muted-foreground">
          <span className="block">Period</span>
          <DateRangeFilter value={range} preset={preset} onChange={(r, p) => { setRange(r); setPreset(p); }} />
        </div>
      </div>
      {mayOrders ? <Orders range={range} preset={preset} mayPm={mayPm} /> : <NotYours what="Maintenance orders" />}
      <section className="mt-6 space-y-3" aria-labelledby="mqa-h">
        <SectionHeading><span id="mqa-h">Go to</span></SectionHeading>
        <QuickActions items={SHORTCUTS} />
      </section>
    </DashboardLayout>
  );
}

function Orders({ range, preset, mayPm }: { range: DateRange; preset: DateRangePreset; mayPm: boolean }) {
  const navigate = useNavigate();
  const now = useMemo(() => new Date(), []);
  const from = range.from ?? startOfDay(now);
  const to = range.to ?? now;
  const analysis = useMaintenanceProblemAnalysis({ from, to });
  const live = analysis.activeRows as unknown as Array<DashboardWo & (typeof analysis.activeRows)[number]>;
  const period = analysis.rows;
  const { data: stopped } = useStoppedLinesCount();
  const finishedToday = useWoFinishedCount(startOfDay(now), now);
  const finishedWeek = useWoFinishedCount(startOfWeek(now, { weekStartsOn: 1 }), now);
  const finishedPeriod = useWoFinishedCount(from, to);
  const kpis = useMaintenanceKpis({ from, to });
  const pm = usePmSchedules();

  const k = useMemo(() => computeKpis(period), [period]);
  const liveK = useMemo(() => computeKpis(live), [live]);
  const waiting = notAccepted(live);
  const staleN = stale(live, now);
  const high = live.filter(isHighPriority);
  const types = typeSplit(period);
  const problemsByHours = useMemo(() => sortGroups(groupByProblem(period), "hours").filter((g) => g.kpis.totalRepairSec > 0), [period]);
  const problemsByCount = useMemo(() => sortGroups(groupByProblem(period), "orders"), [period]);
  const pmDue = useMemo(() => (pm.data ?? [])
    .map((s) => ({ s, status: pmStatus(s, now) }))
    .filter((x) => x.status === "overdue" || x.status === "due_soon"), [pm.data, now]);
  const pmOverdue = pmDue.filter((x) => x.status === "overdue").length;

  const loading = analysis.isLoading;
  const periodRange = preset === "custom" ? "all" : preset;
  const alerts: AlertItem[] = [];
  if (stopped) alerts.push({ tone: "stop", text: `${stopped} line${stopped === 1 ? "" : "s"} stopped, waiting on maintenance`, to: woListHref({ status: "active", range: "all" }) });
  const critical = high.filter((w) => (w.priority ?? "").toLowerCase() === "critical");
  if (critical.length) alerts.push({ tone: "stop", text: `${critical.length} critical order${critical.length === 1 ? "" : "s"} not finished`, to: woListHref({ status: "active", range: "all" }) });
  if (high.length - critical.length > 0) alerts.push({ tone: "hold", text: `${high.length - critical.length} high-priority order${high.length - critical.length === 1 ? "" : "s"} not finished`, to: woListHref({ status: "active", range: "all" }) });
  if (staleN) alerts.push({ tone: "hold", text: `${staleN} in progress for more than 72 hours`, to: woListHref({ status: "stale", range: "all" }) });
  if (waiting) alerts.push({ tone: "hold", text: `${waiting} not accepted by an engineer yet`, to: woListHref({ status: "open", range: "all" }) });
  if (mayPm && pmOverdue) alerts.push({ tone: "hold", text: `${pmOverdue} preventive job${pmOverdue === 1 ? "" : "s"} overdue`, to: "/dashboard/preventive" });
  if (mayPm && pmDue.length - pmOverdue > 0) alerts.push({ tone: "info", text: `${pmDue.length - pmOverdue} preventive job${pmDue.length - pmOverdue === 1 ? "" : "s"} due within 7 days`, to: "/dashboard/preventive" });

  if (analysis.error) {
    return <Panel title="Maintenance orders" error={analysis.error} onRetry={analysis.refetch}>{null}</Panel>;
  }

  return (
    <div className="space-y-6">
      <Panel title="Needs attention" description="What somebody should look at now." loading={loading}>
        <AlertList items={alerts} clear="Nothing stopped, stale, urgent or overdue." />
      </Panel>

      <section className="space-y-3" aria-labelledby="now-h">
        <SectionHeading><span id="now-h">Now</span></SectionHeading>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Not finished" value={liveK.active} loading={loading} icon={<ClipboardList className="h-4 w-4" />}
            sublabel="Every order still open, any day" accent="info" onClick={() => navigate(woListHref({ status: "active", range: "all" }))} />
          <KpiCard label="Not accepted" value={waiting} loading={loading} icon={<Hand className="h-4 w-4" />}
            sublabel="No engineer has taken these" accent={waiting ? "warning" : "ok"} toneValue
            onClick={() => navigate(woListHref({ status: "open", range: "all" }))} />
          <KpiCard label="In progress" value={liveK.inProgress} loading={loading} icon={<Loader2 className="h-4 w-4" />}
            sublabel="Being worked on" accent="info" onClick={() => navigate(woListHref({ status: "in_progress", range: "all" }))} />
          <KpiCard label="Over 72 hours" value={staleN} loading={loading} icon={<Hourglass className="h-4 w-4" />}
            sublabel="In progress for more than 3 days" accent={staleN ? "warning" : "ok"} toneValue
            onClick={() => navigate(woListHref({ status: "stale", range: "all" }))} />
          <KpiCard label="Lines stopped" value={stopped ?? "—"} loading={stopped === undefined && loading} icon={<PowerOff className="h-4 w-4" />}
            sublabel="Waiting on maintenance to resume" accent={stopped ? "danger" : "ok"} toneValue
            onClick={() => navigate(woListHref({ status: "active", range: "all" }))} />
          {mayPm && (
            <KpiCard label="Preventive due" value={pmDue.length} loading={pm.isLoading} icon={<CalendarClock className="h-4 w-4" />}
              sublabel={`${pmOverdue} overdue · due within 7 days`} accent={pmOverdue ? "warning" : "muted"} toneValue
              onClick={() => navigate("/dashboard/preventive")} />
          )}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel title="Open orders by status" loading={loading} to={woListHref({ status: "active", range: "all" })} toLabel="Orders">
            <BarList empty="No order is open."
              items={(["open", "received", "arrived", "in_progress"] as const)
                .map((s) => ({ label: STATUS_LABEL[s], count: live.filter((w) => w.status === s).length, to: woListHref({ status: s, range: "all" }) }))
                .filter((x) => x.count > 0)} />
          </Panel>
          <Panel title="Open orders by priority" loading={loading}>
            <BarList empty="No order is open."
              items={byPriority(live).map((p) => ({ label: p.label.charAt(0).toUpperCase() + p.label.slice(1), count: p.count }))} />
          </Panel>
          <Panel title="Open orders by engineer" description="Who holds what is still open." loading={loading}>
            <BarList empty="No order is open." items={byEngineer(live)} />
          </Panel>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="per-h">
        <SectionHeading><span id="per-h">Period — {format(from, "dd/MM")} – {format(to, "dd/MM")}</span></SectionHeading>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Raised" value={k.totalOrders} loading={loading} icon={<ClipboardList className="h-4 w-4" />}
            sublabel={`${types.corrective} corrective · ${types.preventive} preventive`} accent="info"
            onClick={() => navigate(woListHref({ range: periodRange }))} />
          <KpiCard label="Finished today" value={finishedToday.data ?? 0} loading={finishedToday.isLoading} icon={<CheckCircle2 className="h-4 w-4" />}
            sublabel={`${finishedWeek.data ?? 0} this week (from Monday)`} accent="ok"
            onClick={() => navigate(woListHref({ status: "finished", range: "today" }))} />
          <KpiCard label="Finished in period" value={finishedPeriod.data ?? 0} loading={finishedPeriod.isLoading} icon={<PenTool className="h-4 w-4" />}
            sublabel="By when the work was finished" accent="ok" />
          <KpiCard label="Repair hours" value={formatHours(k.totalRepairSec)} loading={loading} icon={<Wrench className="h-4 w-4" />}
            sublabel={`On ${k.ordersWithHours} order${k.ordersWithHours === 1 ? "" : "s"} with hours recorded`} accent="muted" />
          <KpiCard label="Line downtime" value={formatHours(k.totalDowntimeSec)} loading={loading} icon={<PowerOff className="h-4 w-4" />}
            sublabel={`On ${k.ordersWithDowntime} order${k.ordersWithDowntime === 1 ? "" : "s"} that stopped a line`} accent="muted" />
          <KpiCard label="Average repair" value={kpis.avgMTTRMin == null ? "—" : formatMinutes(kpis.avgMTTRMin)} loading={kpis.isLoading}
            icon={<Timer className="h-4 w-4" />} sublabel="Mean time to repair" accent="muted" />
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <Panel title="Problems costing the most hours" loading={loading} to="/dashboard/maintenance-analysis" toLabel="Analysis">
            <BarList empty="No repair hours recorded in this period."
              items={problemsByHours.map((g) => ({ label: g.problem, count: g.kpis.totalRepairSec, hint: `${g.kpis.totalOrders} order${g.kpis.totalOrders === 1 ? "" : "s"}` }))}
              unit={(sec) => formatHours(sec)} />
          </Panel>
          <Panel title="Most frequent problems" loading={loading} to="/dashboard/maintenance-analysis" toLabel="Analysis">
            <BarList empty="No orders raised in this period."
              items={problemsByCount.map((g) => ({ label: g.problem, count: g.kpis.totalOrders, hint: g.machines.slice(0, 2).join(", ") || undefined }))} />
          </Panel>
          <Panel title="Orders by line" description="The line the order was raised on." loading={loading}>
            <BarList empty="No orders raised in this period." items={byLine(period)} />
          </Panel>
        </div>
        {mayPm && (
          <Panel title="Preventive maintenance coming due" loading={pm.isLoading} error={pm.error} onRetry={() => void pm.refetch()}
            to="/dashboard/preventive" toLabel="Preventive">
            {(pm.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No preventive schedules are set up yet. They are created on the Preventive screen.</p>
            ) : pmDue.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing due in the next 7 days.</p>
            ) : (
              <ul className="divide-y text-sm">
                {pmDue.slice(0, 8).map(({ s, status }) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate">{s.title} <span className="text-muted-foreground">— {s.machine}</span></span>
                    <span className={status === "overdue" ? "shrink-0 font-medium text-warning-strong" : "shrink-0 text-muted-foreground"}>
                      {status === "overdue" ? "Overdue" : "Due"} {s.next_due_at ? format(new Date(s.next_due_at), "dd/MM") : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </section>
    </div>
  );
}
