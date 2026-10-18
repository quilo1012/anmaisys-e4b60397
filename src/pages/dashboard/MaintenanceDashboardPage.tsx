import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/DashboardLayout";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { woKpis, pmDueSoon, type WoRow } from "@/lib/departmentKpis";
import { getCurrentShiftStart } from "@/lib/shifts";
import { Bars, DeptHeader, ErrorBox, Kpi, Panel, QuickActions } from "@/components/dept/DeptDashboard";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type Range = "today" | "week" | "month";

function rangeStart(r: Range, now: Date): Date {
  const d = new Date(now);
  if (r === "today") return getCurrentShiftStart(now);
  d.setDate(d.getDate() - (r === "week" ? 7 : 30));
  return d;
}

export default function MaintenanceDashboardPage() {
  const [range, setRange] = useState<Range>("week");
  const wo = useQuery({
    queryKey: ["dept-maint-wo", range],
    queryFn: async () => {
      const from = rangeStart("month", new Date()).toISOString();
      // Active orders whatever their age, plus everything created or closed in the last 30 days.
      return fetchAllRows<WoRow>({
        range: (a, b) => supabase.from("work_orders")
          .select("id,status,priority,created_at,completed_at,finished_at,closed_at,line_stopped,line_resumed_at,machine")
          .or(`status.in.(open,received,arrived,in_progress),created_at.gte.${from},closed_at.gte.${from}`)
          .neq("wo_type", "warehouse")
          .order("id").range(a, b) as any,
      });
    },
    refetchInterval: 60_000,
  });
  const pm = useQuery({
    queryKey: ["dept-maint-pm"],
    queryFn: async () => {
      const { data, error } = await supabase.from("pm_schedules").select("next_due_at,active");
      if (error) throw error;
      return data ?? [];
    },
  });

  const now = new Date();
  const from = rangeStart(range, now);
  const rows = useMemo(() => (wo.data ?? []).filter((r) =>
    ["open", "received", "arrived", "in_progress"].includes(r.status) || new Date(r.created_at) >= from
    || (r.closed_at && new Date(r.closed_at) >= from)), [wo.data, range]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = woKpis(rows, now, rangeStart("week", now), getCurrentShiftStart(now));
  const p = pmDueSoon(pm.data ?? [], now);
  const byMachine = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (new Date(r.created_at) >= from) m.set(r.machine ?? "—", (m.get(r.machine ?? "—") ?? 0) + 1);
    return [...m].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = () => { wo.refetch(); pm.refetch(); };
  const loading = wo.isLoading || pm.isLoading;

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        <DeptHeader title="Maintenance Dashboard" subtitle="Work orders, preventive maintenance and lines stopped" onRefresh={refetch} refreshing={wo.isFetching}>
          <ToggleGroup type="single" value={range} onValueChange={(v) => v && setRange(v as Range)} size="sm">
            <ToggleGroupItem value="today">This shift</ToggleGroupItem>
            <ToggleGroupItem value="week">7 days</ToggleGroupItem>
            <ToggleGroupItem value="month">30 days</ToggleGroupItem>
          </ToggleGroup>
        </DeptHeader>
        {wo.isError || pm.isError ? <ErrorBox what="Maintenance data" onRetry={refetch} /> : loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Open" value={k.open} to="/dashboard/work-orders" />
              <Kpi label="In progress" value={k.inProgress} to="/dashboard/work-orders" />
              <Kpi label={`Older than ${72}h`} value={k.stale} tone={k.stale ? "warn" : undefined} to="/dashboard/work-orders" />
              <Kpi label="Lines stopped" value={k.lineDown} tone={k.lineDown ? "bad" : undefined} to="/dashboard/downtime" />
              <Kpi label="High / critical open" value={k.highOpen} tone={k.highOpen ? "bad" : undefined} to="/dashboard/work-orders" />
              <Kpi label="Closed this shift" value={k.doneToday} />
              <Kpi label="Closed last 7 days" value={k.doneWeek} />
              <Kpi label="PM overdue / due in 7d" value={`${p.overdue} / ${p.soon}`} tone={p.overdue ? "warn" : undefined} to="/dashboard/preventive" />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="Open orders by priority">
                <Bars empty="No open orders." rows={Object.entries(k.byPriority).map(([label, value]) => ({ label, value }))} />
              </Panel>
              <Panel title="Orders raised by machine">
                <Bars empty="No orders raised in this period." rows={byMachine} />
              </Panel>
            </div>
          </>
        )}
        <QuickActions items={[
          { label: "Maintenance Orders", to: "/dashboard/work-orders", action: "wo.view" },
          { label: "Downtime & Reliability", to: "/dashboard/downtime", action: "downtime.view" },
          { label: "Preventive", to: "/dashboard/preventive", action: "pm.view" },
          { label: "Machines", to: "/dashboard/machines", action: "machines.view" },
          { label: "Stock", to: "/dashboard/stock", action: "stock.view" },
          { label: "Reports", to: "/dashboard/reports", action: "reports.analytics" },
        ]} />
      </div>
    </DashboardLayout>
  );
}
