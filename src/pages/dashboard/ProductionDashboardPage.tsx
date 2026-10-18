import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { getCurrentFactoryShift } from "@/lib/shifts";
import { productionTotals, staffingKpis, type AllocRow } from "@/lib/departmentKpis";
import { Bars, DeptHeader, ErrorBox, Kpi, Panel, QuickActions } from "@/components/dept/DeptDashboard";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { useRole } from "@/hooks/useRole";

type Shift = "Day" | "Night";

export default function ProductionDashboardPage() {
  const cur = getCurrentFactoryShift();
  const [date, setDate] = useState(cur.sessionDate);
  const [shift, setShift] = useState<Shift>(cur.shiftCode === "night" ? "Night" : "Day");
  const { can } = useRole();
  const seeStaff = can("headcount.view");

  const alloc = useQuery({
    queryKey: ["dept-prod-alloc", date, shift],
    enabled: seeStaff,
    queryFn: () => fetchAllRows<AllocRow & { id: string }>({
      range: (a, b) => supabase.from("daily_allocations").select("id,employee_id,status,area_id")
        .eq("on_date", date).eq("shift", shift).order("id").range(a, b) as any,
    }),
  });
  const areas = useQuery({
    queryKey: ["dept-prod-areas"],
    enabled: seeStaff,
    queryFn: async () => {
      const { data, error } = await supabase.from("headcount_areas").select("id,name,sort_order").eq("active", true);
      if (error) throw error;
      return data ?? [];
    },
  });
  const prod = useQuery({
    queryKey: ["dept-prod-items", date, shift],
    queryFn: async () => {
      const { data, error } = await supabase.from("production_sessions")
        .select("line,production_items(target_qty,actual_qty)")
        .eq("session_date", date).ilike("shift", shift);
      if (error) throw error;
      return data ?? [];
    },
  });
  const stops = useQuery({
    queryKey: ["dept-prod-stops", date, shift],
    queryFn: async () => {
      const { data, error } = await supabase.from("production_downtimes")
        .select("line,duration_minutes,ended_at").eq("occurred_date", date).ilike("shift", shift);
      if (error) throw error;
      return data ?? [];
    },
  });
  const ot = useQuery({
    queryKey: ["dept-prod-ot", date],
    enabled: can("overtime.manage"),
    queryFn: async () => {
      const { data, error } = await supabase.from("overtime_requests").select("headcount,status").eq("on_date", date);
      if (error) throw error;
      return data ?? [];
    },
  });

  const s = staffingKpis(alloc.data ?? []);
  const areaName = useMemo(() => new Map((areas.data ?? []).map((a) => [a.id, a.name])), [areas.data]);
  const byArea = Object.entries(s.byArea).map(([id, value]) => ({ label: areaName.get(id) ?? "Other", value })).sort((a, b) => b.value - a.value);
  const items = (prod.data ?? []).flatMap((x: any) => x.production_items ?? []);
  const totals = productionTotals(items);
  const byLine = (prod.data ?? []).map((x: any) => ({ label: x.line, value: productionTotals(x.production_items ?? []).actual })).filter((r) => r.value > 0);
  const stopMin = (stops.data ?? []).reduce((t, r) => t + (r.duration_minutes ?? 0), 0);
  const openStops = (stops.data ?? []).filter((r) => !r.ended_at).length;
  const otOpen = (ot.data ?? []).filter((r) => r.status === "open").length;

  const queries = [alloc, areas, prod, stops, ot];
  const refetch = () => queries.forEach((q) => q.refetch());
  const err = queries.some((q) => q.isError);
  const loading = prod.isLoading || stops.isLoading || (seeStaff && alloc.isLoading);
  const q = `?date=${date}&shift=${shift}`;

  return (
    <DashboardLayout>
      <div className="space-y-5 p-4 md:p-6">
        <DeptHeader title="Production Dashboard" subtitle={`${shift} shift · ${date}`} onRefresh={refetch} refreshing={prod.isFetching}>
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 w-40" />
          <ToggleGroup type="single" value={shift} onValueChange={(v) => v && setShift(v as Shift)} size="sm">
            <ToggleGroupItem value="Day">Day</ToggleGroupItem>
            <ToggleGroupItem value="Night">Night</ToggleGroupItem>
          </ToggleGroup>
        </DeptHeader>
        {err ? <ErrorBox what="Production data" onRetry={refetch} /> : loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Kpi label="Produced" value={totals.actual.toLocaleString()} to="/dashboard/shift-history" />
              <Kpi label="Target" value={totals.target ? totals.target.toLocaleString() : "—"} hint={totals.pct != null ? `${totals.pct}% of target` : "No target set"} />
              <Kpi label="Stop minutes" value={stopMin} hint={openStops ? `${openStops} still open` : undefined} tone={openStops ? "warn" : undefined} to="/dashboard/stop-analysis" />
              {can("overtime.manage") && <Kpi label="Overtime requests open" value={otOpen} to="/dashboard/overtime" />}
              {seeStaff && <>
                <Kpi label="On the board" value={s.planned} to={`/dashboard/headcount${q}`} />
                <Kpi label="Working" value={s.working} hint={s.overtime ? `${s.overtime} on overtime` : undefined} to={`/dashboard/headcount${q}`} />
                <Kpi label="Absent" value={s.absent} tone={s.absent ? "warn" : undefined} hint={`Sick ${s.absence.sick} · Holiday ${s.absence.holiday} · Unpaid ${s.absence.unpaid}`} />
                <Kpi label="Training" value={s.training} />
              </>}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Panel title="Produced by line"><Bars empty="Nothing logged for this shift." rows={byLine} /></Panel>
              {seeStaff && <Panel title="People by area"><Bars empty="No board saved for this shift." rows={byArea} /></Panel>}
            </div>
          </>
        )}
        <QuickActions items={[
          { label: "Headcount", to: "/dashboard/headcount", action: "headcount.view" },
          { label: "Production Control", to: "/dashboard/shift-history", action: "production.manage" },
          { label: "RAG Weekly", to: "/dashboard/rag-weekly", action: "rag.view" },
          { label: "Overtime", to: "/dashboard/overtime", action: "overtime.manage" },
          { label: "Attendance", to: "/dashboard/attendance", action: "attendance.manage" },
          { label: "Stop Analysis", to: "/dashboard/stop-analysis", action: "stopanalysis.view" },
          { label: "Reports", to: "/dashboard/reports", action: "reports.analytics" },
        ]} />
      </div>
    </DashboardLayout>
  );
}
