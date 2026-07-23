import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, LayoutDashboard, Users, Timer, Activity, Package, BarChart3, Trophy, Award, TrendingUp, TrendingDown, Printer, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useTotalPartsUsedToday, useProducts } from "@/hooks/useStock";
import { useMachines, useLines } from "@/hooks/useMachines";
import { useEngineerScores } from "@/hooks/useEngineerScores";
import { useAllWoMetrics } from "@/hooks/useWoMetrics";
import { useMaintenanceKpis } from "@/hooks/useMaintenanceKpis";
import { differenceInMinutes, format, subDays, startOfDay, endOfDay } from "date-fns";
import { useDowntime } from "@/hooks/useDowntime";
import { reconcileMinutes } from "@/lib/downtimeReconcile";
import { formatMTBF } from "@/lib/formatDuration";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LabelList } from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMinutes } from "@/lib/formatDuration";
import { DateRangePreset, DateRange, getPresetRange } from "@/components/DateRangeFilter";
import { Link } from "react-router-dom";
import { SLA_TARGETS } from "@/lib/sla";
import { resolveLine } from "@/lib/resolveLine";
import { ReportsFilterBar } from "@/components/reports/ReportsFilterBar";
import { KpiCard } from "@/components/reports/KpiCard";
import { QUALITY_STATUSES } from "@/lib/qualityConstants";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { EmptyState } from "@/components/EmptyState";

const DONE_STATUSES = ["completed", "closed", "finished"];
const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#10b981", "#6b7280"];

const truncLabel = (s: string, max = 20) => s.length > max ? s.slice(0, max - 1) + "…" : s;

/** Show minutes as "N min" under 60, else "Xh Ym". */
const fmtMin = (m: number | null | undefined) => {
  if (m === null || m === undefined || Number.isNaN(Number(m))) return "—";
  const minutes = Math.max(0, Math.round(Number(m)));
  return minutes >= 60 ? formatMinutes(minutes) : `${minutes} min`;
};

const EmptyChart = () => (
  <EmptyState
    icon={BarChart3}
    title="No data available"
    description="No records match the selected filters."
    className="py-8"
  />
);


export default function AnalyticsPage() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [drPreset, setDrPreset] = useState<DateRangePreset>("30d");
  const [drRange, setDrRange] = useState<DateRange>(() => getPresetRange("30d"));
  const startDate = drRange.from ?? startOfDay(subDays(new Date(), 30));
  const endDate = drRange.to ?? endOfDay(new Date());

  const { data: rawWOs, isLoading: woLoading } = useWorkOrders();
  const { data: partsToday } = useTotalPartsUsedToday();
  const { data: products, isLoading: productsLoading } = useProducts();
  const { data: machines, isLoading: machinesLoading } = useMachines();
  const { data: linesData } = useLines();
  const { data: engineerScores, isLoading: scoresLoading } = useEngineerScores();
  const { data: woMetricsRange, isLoading: metricsLoading } = useAllWoMetrics({ from: startDate, to: endDate });

  // Quality actions in the selected date range → Quality Analytics section.
  const { data: qaRows = [] } = useQuery({
    queryKey: ["analytics-quality", startDate.toISOString(), endDate.toISOString()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quality_actions")
        .select("recorded_at, status, severity, line, department")
        .gte("recorded_at", startDate.toISOString())
        .lte("recorded_at", endDate.toISOString());
      if (error) throw error;
      return (data ?? []) as Array<{ recorded_at: string; status: string | null; severity: string | null; line: string | null; department: string | null }>;
    },
  });

  const qa = useMemo(() => {
    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byLine: Record<string, number> = {};
    const byDept: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    for (const r of qaRows) {
      byStatus[r.status || "unknown"] = (byStatus[r.status || "unknown"] || 0) + 1;
      if (r.severity) bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
      byLine[r.line || "—"] = (byLine[r.line || "—"] || 0) + 1;
      byDept[r.department || "—"] = (byDept[r.department || "—"] || 0) + 1;
      const day = (r.recorded_at || "").slice(0, 10);
      if (day) byDay[day] = (byDay[day] || 0) + 1;
    }
    const total = qaRows.length;
    const sevOrder = ["low", "medium", "high", "critical"];
    return {
      total,
      open: (byStatus["todo"] || 0) + (byStatus["in_progress"] || 0),
      completed: byStatus["complete"] || 0,
      critical: (bySeverity["high"] || 0) + (bySeverity["critical"] || 0),
      statusData: QUALITY_STATUSES.map((s) => ({ name: s.label, value: byStatus[s.value] || 0, color: s.color })),
      severityData: sevOrder.filter((s) => bySeverity[s]).map((s) => ({ name: s.charAt(0).toUpperCase() + s.slice(1), value: bySeverity[s] })),
      lineData: Object.entries(byLine).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value })),
      deptData: Object.entries(byDept).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, value]) => ({ name, value })),
      trendData: Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])).map(([day, value]) => ({ name: format(new Date(day), "dd/MM"), value })),
    };
  }, [qaRows]);

  // Filter WOs by date range
  const allWOs = useMemo(() => {
    if (!rawWOs) return undefined;
    return rawWOs.filter((w) => {
      const d = new Date(w.created_at);
      return d >= startDate && d <= endDate;
    });
  }, [rawWOs, startDate, endDate]);

  const { data: userCount } = useQuery({
    queryKey: ["user_count"],
    queryFn: async () => {
      // Try exact count first
      const { count, error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true });
      if (!error && count !== null) return count;
      // Fallback: fetch ids and count length (works around RLS/head quirks)
      const { data, error: fallbackError } = await supabase.from("profiles").select("id");
      if (fallbackError) {
        console.error("Total Users query failed:", fallbackError);
        return 0;
      }
      return data?.length ?? 0;
    },
  });

  const today = new Date().toDateString();
  const openCount = allWOs?.filter((w) => w.status === "open").length ?? 0;
  const inProgressCount = allWOs?.filter((w) => w.status === "in_progress").length ?? 0;
  const completedToday = allWOs?.filter((w) => DONE_STATUSES.includes(w.status) && (w.closed_at || w.completed_at || w.finished_at) && new Date(w.closed_at || w.completed_at || w.finished_at!).toDateString() === today).length ?? 0;
  const lowStockCount = products?.filter((p) => p.quantity <= p.min_stock).length ?? 0;
  const hasNoActivity = !woLoading && !!rawWOs && (allWOs?.length ?? 0) === 0;

  // Single source of truth for Response / MTTR / MTBF — shared with Executive Dashboard.
  const { avgResponseMin, avgMTTRMin, avgMTBFMin } = useMaintenanceKpis({ from: startDate, to: endDate });
  const kpis = { avgResponse: avgResponseMin, avgMTTR: avgMTTRMin, avgMTBF: avgMTBFMin };


  // Compute days for the "WOs per Day" chart based on the selected range
  const rangeDays = useMemo(() => {
    const diffMs = endDate.getTime() - startDate.getTime();
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }, [startDate, endDate]);

  const wosPerDay = useMemo(() => {
    if (!allWOs) return [];
    const displayDays = Math.min(rangeDays, 30); // show at most 30 bars
    const days: { date: string; count: number }[] = [];
    for (let i = displayDays - 1; i >= 0; i--) {
      const d = subDays(endDate, i);
      days.push({ date: format(d, "dd/MM"), count: allWOs.filter((w) => new Date(w.created_at).toDateString() === d.toDateString()).length });
    }
    return days;
  }, [allWOs, endDate, rangeDays]);

  const ordersByStatus = useMemo(() => {
    if (!allWOs) return [];
    const sc: Record<string, number> = {};
    allWOs.forEach((w) => { sc[w.status] = (sc[w.status] || 0) + 1; });
    return Object.entries(sc).map(([status, count]) => ({ name: status, value: count }));
  }, [allWOs]);

  const lineProblems = useMemo(() => {
    if (!allWOs) return [];
    const lc: Record<string, number> = {};
    allWOs.forEach((w) => {
      const line = resolveLine(w, machines, "No Line");
      lc[line] = (lc[line] || 0) + 1;
    });
    return Object.entries(lc)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([line, count]) => ({ line, count }));
  }, [allWOs, machines]);

  const topProblems = useMemo(() => {
    if (!allWOs) return [];
    const pc: Record<string, number> = {};
    allWOs.forEach((w) => { pc[w.description] = (pc[w.description] || 0) + 1; });
    return Object.entries(pc).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([problem, count]) => ({ problem, count }));
  }, [allWOs]);

  const metricsById = useMemo(() => {
    const m = new Map<string, typeof woMetricsRange[number]>();
    (woMetricsRange ?? []).forEach((row) => { if (row.id) m.set(row.id, row); });
    return m;
  }, [woMetricsRange]);

  const slaCompliance = useMemo(() => {
    if (!allWOs) return { rate: 0, total: 0, met: 0 };
    const relevant = allWOs.filter((w) => DONE_STATUSES.includes(w.status));
    let met = 0;
    let counted = 0;
    relevant.forEach((wo) => {
      const m = metricsById.get(wo.id);
      if (!m || typeof m.response_time_sec !== "number") return;
      counted++;
      const target = SLA_TARGETS[wo.priority || "medium"] || 60;
      const responseMin = m.response_time_sec / 60;
      if (responseMin <= target) met++;
    });
    return { rate: counted ? Math.round((met / counted) * 100) : 0, total: counted, met };
  }, [allWOs, metricsById]);

  const ordersByPriority = useMemo(() => {
    if (!allWOs) return [];
    const pc: Record<string, number> = {};
    allWOs.forEach((w) => { pc[w.priority || "medium"] = (pc[w.priority || "medium"] || 0) + 1; });
    return Object.entries(pc).map(([priority, count]) => ({ priority, count }));
  }, [allWOs]);

  const { data: partsCountData } = useQuery({
    queryKey: ["parts_used_counts_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("parts_used").select("work_order_id") as any;
      if (error) throw error;
      const set = new Set((data as any[]).map((d: any) => d.work_order_id));
      return set;
    },
  });

  const noPartsPercent = useMemo(() => {
    if (!allWOs || !partsCountData) return 0;
    const done = allWOs.filter((w) => DONE_STATUSES.includes(w.status));
    if (!done.length) return 0;
    const noParts = done.filter((w) => !partsCountData.has(w.id));
    return Math.round((noParts.length / done.length) * 100);
  }, [allWOs, partsCountData]);

  // Map line_id -> line name
  const lineNameById = useMemo(() => {
    const m = new Map<string, string>();
    (linesData ?? []).forEach((l: any) => m.set(l.id, l.name));
    return m;
  }, [linesData]);

  // Determine shift (day=06:00–18:00 Europe/London, else night) from an ISO timestamp
  const getLondonShift = (iso: string | null | undefined): "day" | "night" | null => {
    if (!iso) return null;
    try {
      const hourStr = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        hour12: false,
      }).format(new Date(iso));
      const h = parseInt(hourStr, 10);
      if (Number.isNaN(h)) return null;
      return h >= 6 && h < 18 ? "day" : "night";
    } catch {
      return null;
    }
  };

  const downtimeByMachine = useMemo(() => {
    if (!allWOs) return [];
    const map: Record<string, { day: number; night: number; lines: Set<string> }> = {};
    allWOs.filter((w) => DONE_STATUSES.includes(w.status)).forEach((wo: any) => {
      const m = metricsById.get(wo.id);
      if (!m || typeof m.active_repair_sec !== "number") return;
      const repair = m.active_repair_sec / 60;
      const lineName = wo.line_id ? lineNameById.get(wo.line_id) : null;
      const key = (wo.machine && wo.machine.trim()) || lineName || "Unassigned";
      if (!map[key]) map[key] = { day: 0, night: 0, lines: new Set() };
      const shift = getLondonShift(wo.line_stopped_at || wo.started_at || wo.created_at);
      if (shift === "day") map[key].day += repair;
      else if (shift === "night") map[key].night += repair;
      else map[key].day += repair; // fallback bucket
      if (lineName) map[key].lines.add(lineName);
    });
    return Object.entries(map)
      .map(([machine, v]) => ({
        machine,
        day: Math.round(v.day),
        night: Math.round(v.night),
        total: Math.round(v.day + v.night),
        lines: Array.from(v.lines).sort().join(", ") || "—",
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [allWOs, metricsById, lineNameById]);

  const { data: downtimeRecords } = useDowntime();

  // Aligned with Downtime page (parallel stoppages counted once).
  const totalDowntimeMinutes = useMemo(() => {
    const recs = downtimeRecords || [];
    const rangeStartMs = startOfDay(startDate).getTime();
    const rangeEndMs = Math.min(endOfDay(endDate).getTime(), Date.now());
    return reconcileMinutes(
      recs.map((r) => ({ start: r.started_at, end: r.ended_at })),
      rangeStartMs,
      rangeEndMs,
      Date.now(),
    );
  }, [downtimeRecords, startDate, endDate]);


  const mostAffectedLine = useMemo(() => {
    if (!allWOs) return null;
    const map: Record<string, number> = {};
    allWOs.filter((w) => DONE_STATUSES.includes(w.status)).forEach((wo: any) => {
      const m = metricsById.get(wo.id);
      if (!m || typeof m.active_repair_sec !== "number") return;
      const name = (wo.line_id && lineNameById.get(wo.line_id)) || "Unassigned";
      map[name] = (map[name] || 0) + m.active_repair_sec / 60;
    });
    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
    if (!sorted.length) return null;
    return { name: sorted[0][0], minutes: Math.round(sorted[0][1]) };
  }, [allWOs, metricsById, lineNameById]);

  // Most used machines (highest WO count)
  const mostUsedMachines = useMemo(() => {
    if (!allWOs) return [];
    const map: Record<string, number> = {};
    allWOs.forEach((w) => { map[w.machine] = (map[w.machine] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([machine, count]) => ({ machine, count }));
  }, [allWOs]);

  // Maintenance frequency: avg WOs per machine per month
  const maintenanceFrequency = useMemo(() => {
    if (!allWOs || !allWOs.length) return [];
    const map: Record<string, { count: number; firstWO: Date; lastWO: Date }> = {};
    allWOs.forEach((w) => {
      const d = new Date(w.created_at);
      if (!map[w.machine]) map[w.machine] = { count: 0, firstWO: d, lastWO: d };
      map[w.machine].count++;
      if (d < map[w.machine].firstWO) map[w.machine].firstWO = d;
      if (d > map[w.machine].lastWO) map[w.machine].lastWO = d;
    });
    return Object.entries(map).map(([machine, v]) => {
      const months = Math.max(1, differenceInMinutes(v.lastWO, v.firstWO) / (60 * 24 * 30));
      return { machine, avgPerMonth: Math.round((v.count / months) * 10) / 10 };
    }).sort((a, b) => b.avgPerMonth - a.avgPerMonth).slice(0, 8);
  }, [allWOs]);

  const engineerPerformance = useMemo(() => {
    if (!allWOs) return [];
    const engineers: Record<string, { name: string; completed: number; totalResp: number; totalMTTR: number; respCount: number; mttrCount: number }> = {};
    allWOs.filter((w) => DONE_STATUSES.includes(w.status) && w.engineer_id).forEach((wo) => {
      const eid = wo.engineer_id!;
      const name = wo.engineer_name || (wo as any).engineer?.name || "Unknown";
      if (!engineers[eid]) engineers[eid] = { name, completed: 0, totalResp: 0, totalMTTR: 0, respCount: 0, mttrCount: 0 };
      engineers[eid].completed++;
      const m = metricsById.get(wo.id);
      if (m && typeof m.response_time_sec === "number") {
        engineers[eid].totalResp += m.response_time_sec / 60;
        engineers[eid].respCount++;
      }
      if (m && typeof m.active_repair_sec === "number") {
        engineers[eid].totalMTTR += m.active_repair_sec / 60;
        engineers[eid].mttrCount++;
      }
    });
    return Object.values(engineers).map((e) => ({
      name: e.name,
      completed: e.completed,
      avgResponse: e.respCount ? Math.round(e.totalResp / e.respCount) : 0,
      avgMTTR: e.mttrCount ? Math.round(e.totalMTTR / e.mttrCount) : 0,
    })).sort((a, b) => b.completed - a.completed);
  }, [allWOs, metricsById]);


  // Merge ranking with scores
  const rankedEngineers = useMemo(() => {
    const scoreMap: Record<string, number> = {};
    engineerScores?.forEach((s) => { scoreMap[s.engineer_name || ""] = s.score; });
    return engineerPerformance.map((e) => ({ ...e, score: scoreMap[e.name] ?? 0 })).sort((a, b) => b.score - a.score);
  }, [engineerPerformance, engineerScores]);

  return (
    <DashboardLayout>
      <div className="space-y-6 print-content">
        {/* Print Header — visible only when printing/exported */}
        <ReportPrintHeader
          title="Analytics Report"
          periodLabel={`${format(startDate, "dd/MM/yyyy HH:mm")} — ${format(endDate, "dd/MM/yyyy HH:mm")}`}
        />
        <div className="hidden print:grid grid-cols-2 gap-4 text-sm mb-4">
          <div className="border rounded p-2">
            <p className="text-xs uppercase text-muted-foreground">Total Downtime (Period)</p>
            <p className="text-base font-bold">{fmtMin(totalDowntimeMinutes)}</p>
          </div>
          <div className="border rounded p-2">
            <p className="text-xs uppercase text-muted-foreground">Most Affected Line</p>
            <p className="text-base font-bold">
              {mostAffectedLine ? `${mostAffectedLine.name} — ${fmtMin(mostAffectedLine.minutes)}` : "—"}
            </p>
          </div>
        </div>


        <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6" /> Analytics</h2>
            <p className="text-muted-foreground">KPIs, charts, and performance metrics</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => {
              if (role !== "admin" && (role !== "manager" && role !== "maintenance_manager")) {
                toast({ title: "Cannot print", description: "You don't have permission to print reports.", variant: "destructive" });
                return;
              }
              window.print();
            }}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
          </div>
        </div>

        {/* Date Range Filters */}
        <ReportsFilterBar
          dateRange={drRange}
          datePreset={drPreset}
          onDateChange={(r, p) => { setDrRange(r); setDrPreset(p); }}
          storageKey="analytics-page"
        >
          <Badge variant="secondary" className="text-xs">{allWOs?.length ?? 0} WOs in range</Badge>
        </ReportsFilterBar>

        {(woLoading || machinesLoading || metricsLoading || scoresLoading || productsLoading) && !rawWOs && (
          <div className="space-y-6 print:hidden" aria-busy="true" aria-label="Loading analytics">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={`kpi-${i}`} className="h-28 w-full" />
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={`chart-${i}`} className="h-72 w-full" />
              ))}
            </div>
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {/* KPI cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard accent="blue" icon={<ClipboardList className="h-4 w-4" />} label="Open WOs" value={openCount} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
          <KpiCard accent="indigo" icon={<LayoutDashboard className="h-4 w-4" />} label="In Progress" value={inProgressCount} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
          <KpiCard accent="green" icon={<ClipboardList className="h-4 w-4" />} label="Completed Today" value={completedToday} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
          <KpiCard accent="muted" icon={<Users className="h-4 w-4" />} label="Total Users" value={userCount ?? 0} />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard accent="indigo" icon={<Timer className="h-4 w-4" />} label="Avg Response" value={fmtMin(kpis.avgResponse)} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
          <KpiCard accent="amber" icon={<Activity className="h-4 w-4" />} label="Avg MTTR" value={fmtMin(kpis.avgMTTR)} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
          <KpiCard accent="purple" icon={<Activity className="h-4 w-4" />} label="Avg MTBF" value={formatMTBF(kpis.avgMTBF / 60)} sublabel={hasNoActivity ? "No activity in selected period" : "Mean Time Between Failures"} />
          <KpiCard accent={slaCompliance.rate < 80 ? "red" : "green"} icon={<Timer className="h-4 w-4" />} label="SLA Compliance" value={`${slaCompliance.rate}%`} valueClassName={slaCompliance.rate < 80 ? "text-destructive" : "text-green-600"} sublabel={hasNoActivity ? "No activity in selected period" : undefined} />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 print:hidden">
          <Link to="/dashboard/downtime" className="block">
            <Card className="hover:border-primary transition-colors h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Downtime & Reliability</CardTitle>
                <TrendingDown className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Open the dedicated downtime page for totals, records and the heatmap.</p>
              </CardContent>
            </Card>
          </Link>
        </div>


        {/* Charts */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">WOs per Day (Last 7 Days)</CardTitle></CardHeader>
            <CardContent>
              {!wosPerDay.length || wosPerDay.every((d: any) => !d.count) ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={wosPerDay}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Orders by Status</CardTitle></CardHeader>
            <CardContent>
              {!ordersByStatus.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={ordersByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} labelLine={false} label={({ name, percent }) => (percent >= 0.05 ? `${String(name).replace(/_/g, " ")} ${(percent * 100).toFixed(0)}%` : "")}>
                      {ordersByStatus.map((entry, i) => {
                        const STATUS_COLORS: Record<string, string> = {
                          open: "#ef4444",
                          in_progress: "#f59e0b",
                          finished: "#22c55e",
                          completed: "#22c55e",
                          done: "#14b8a6",
                          closed: "#14b8a6",
                          force_closed: "#6b7280",
                          received: "#3b82f6",
                          arrived: "#8b5cf6",
                        };
                        return <Cell key={i} fill={STATUS_COLORS[entry.name] || COLORS[i % COLORS.length]} />;
                      })}
                    </Pie>
                    <Tooltip formatter={(v: number, n: string) => [v, String(n).replace(/_/g, " ")]} />
                    <Legend formatter={(value: string) => <span style={{ color: "hsl(var(--foreground))" }}>{value.replace(/_/g, " ")}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* NEW: WOs per Machine Type */}
          <Card>
            <CardHeader><CardTitle className="text-base">WOs per Machine Type</CardTitle></CardHeader>
            <CardContent>
              {(() => {
                const wosByType: Record<string, number> = {};
                if (allWOs && machines) {
                  const machineTypeMap: Record<string, string> = {};
                  machines.forEach((m) => { machineTypeMap[m.name] = m.machine_type || "No Machine Assigned"; });
                  allWOs.forEach((w) => {
                    const t = w.machine ? (machineTypeMap[w.machine] || "No Machine Assigned") : "No Machine Assigned";
                    wosByType[t] = (wosByType[t] || 0) + 1;
                  });
                }
                const data = Object.entries(wosByType).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => ({ type, count }));
                return !data.length ? (
                  <EmptyChart />
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={data} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="type" width={140} tick={{ fontSize: 11 }}  /><Tooltip /><Bar dataKey="count" fill="#8b5cf6" name="WOs" radius={[0, 4, 4, 0]} /></BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </CardContent>
          </Card>

          {/* NEW: Machine Status Distribution */}
          <Card>
            <CardHeader><CardTitle className="text-base">Machine Status Distribution</CardTitle></CardHeader>
            <CardContent>
              {(() => {
                const statusCounts: Record<string, number> = {};
                machines?.forEach((m) => {
                  const s = m.status || "active";
                  statusCounts[s] = (statusCounts[s] || 0) + 1;
                });
                const data = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));
                const STATUS_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#6b7280", "#8b5cf6"];
                return !data.length ? (
                  <EmptyChart />
                ) : (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} labelLine={false} label={({ name, percent }) => (percent >= 0.05 ? `${String(name).replace(/_/g, " ")} ${(percent * 100).toFixed(0)}%` : "")}>
                        {data.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number, n: string) => [v, String(n).replace(/_/g, " ")]} />
                      <Legend formatter={(value: string) => <span style={{ color: "hsl(var(--foreground))" }}>{value.replace(/_/g, " ")}</span>} />
                    </PieChart>
                  </ResponsiveContainer>
                );
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Lines with Most Problems</CardTitle></CardHeader>
            <CardContent>
              {!lineProblems.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={lineProblems} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="line" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Top 5 Problems</CardTitle></CardHeader>
            <CardContent>
              {!topProblems.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={topProblems} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="problem" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="count" radius={[0, 4, 4, 0]}>{topProblems.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}<LabelList dataKey="count" position="right" fontSize={11} /></Bar></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Orders by Priority</CardTitle></CardHeader>
            <CardContent>
              {!ordersByPriority.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={ordersByPriority}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="priority" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Most Used Machines</CardTitle></CardHeader>
            <CardContent>
              {!mostUsedMachines.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={mostUsedMachines} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="machine" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" name="Total WOs" radius={[0, 4, 4, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Maintenance Frequency (avg WOs/month)</CardTitle></CardHeader>
            <CardContent>
              {!maintenanceFrequency.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={maintenanceFrequency} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="machine" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="avgPerMonth" fill="hsl(var(--accent))" name="Avg/Month" radius={[0, 4, 4, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>


        {/* Engineer Ranking */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Trophy className="h-5 w-5 text-yellow-500" /> Engineer Ranking</CardTitle></CardHeader>
          <CardContent>
            {!rankedEngineers.length ? (
              <EmptyChart />
            ) : (
              <div className="space-y-6">
                {/* Top 3 podium */}
                <div className="flex justify-center gap-4 items-end">
                  {rankedEngineers.slice(0, 3).map((eng, i) => {
                    const heights = ["h-28", "h-24", "h-20"];
                    const medals = [<Award key="g" className="h-6 w-6 text-yellow-500" />, <Award key="s" className="h-5 w-5 text-gray-400" />, <Award key="b" className="h-5 w-5 text-orange-600" />];
                    return (
                      <div key={eng.name} className="flex flex-col items-center">
                        {medals[i]}
                        <p className="text-sm font-bold mt-1">{eng.name}</p>
                        <p className="text-lg font-bold text-primary">{eng.score}</p>
                        <div className={`w-20 ${heights[i]} bg-primary/20 rounded-t-lg flex items-end justify-center pb-1`}>
                          <span className="text-xs text-muted-foreground">{eng.completed} WOs</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Full table */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">#</th>
                        <th className="px-3 py-2 text-left font-medium">Engineer</th>
                        <th className="px-3 py-2 text-center font-medium">Score</th>
                        <th className="px-3 py-2 text-center font-medium">Completed</th>
                        <th className="px-3 py-2 text-center font-medium">Avg Response</th>
                        <th className="px-3 py-2 text-center font-medium">Avg MTTR</th>
                        <th className="px-3 py-2 text-center font-medium">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rankedEngineers.map((eng, i) => (
                        <tr key={eng.name} className="border-t">
                          <td className="px-3 py-2 font-bold">{i + 1}</td>
                          <td className="px-3 py-2 font-medium">{eng.name}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant={eng.score >= 0 ? "default" : "destructive"}>{eng.score}</Badge>
                          </td>
                          <td className="px-3 py-2 text-center">{eng.completed}</td>
                          <td className="px-3 py-2 text-center">{fmtMin(eng.avgResponse)}</td>
                          <td className="px-3 py-2 text-center">{fmtMin(eng.avgMTTR)}</td>
                          <td className="px-3 py-2 text-center">
                            {eng.score > 0 ? <TrendingUp className="h-4 w-4 text-green-500 inline" /> : eng.score < 0 ? <TrendingDown className="h-4 w-4 text-red-500 inline" /> : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Quality Analytics ── */}
        <div className="space-y-4 print:break-inside-avoid">
          <h3 className="text-lg font-bold flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /> Quality Analytics</h3>
          {qa.total === 0 ? (
            <Card><CardContent className="py-8"><p className="text-center text-sm text-muted-foreground">No quality actions in this period.</p></CardContent></Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard accent="blue" icon={<ClipboardList className="h-4 w-4" />} label="Total Actions" value={qa.total} />
                <KpiCard accent="amber" icon={<Timer className="h-4 w-4" />} label="Open" value={qa.open} />
                <KpiCard accent="green" icon={<Award className="h-4 w-4" />} label="Completed" value={qa.completed} />
                <KpiCard accent="red" icon={<TrendingDown className="h-4 w-4" />} label="High / Critical" value={qa.critical} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-base">Actions by Status</CardTitle></CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={qa.statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                          {qa.statusData.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip /><Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Actions by Severity</CardTitle></CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={qa.severityData}>
                        <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip />
                        <Bar dataKey="value" fill="hsl(24 90% 55%)" radius={[4, 4, 0, 0]}><LabelList dataKey="value" position="top" /></Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Actions by Line</CardTitle></CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={qa.lineData} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} fontSize={12} /><YAxis type="category" dataKey="name" width={90} fontSize={11} /><Tooltip />
                        <Bar dataKey="value" fill="hsl(217 91% 60%)" radius={[0, 4, 4, 0]}><LabelList dataKey="value" position="right" /></Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Actions by Department</CardTitle></CardHeader>
                  <CardContent className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={qa.deptData} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} fontSize={12} /><YAxis type="category" dataKey="name" width={90} fontSize={11} /><Tooltip />
                        <Bar dataKey="value" fill="hsl(262 83% 58%)" radius={[0, 4, 4, 0]}><LabelList dataKey="value" position="right" /></Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader><CardTitle className="text-base">Actions Trend</CardTitle></CardHeader>
                <CardContent className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={qa.trendData}>
                      <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={11} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip />
                      <Bar dataKey="value" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
