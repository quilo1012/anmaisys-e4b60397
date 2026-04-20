import { useState, useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import appliedLogo from "@/assets/appliedlogo.jpeg";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, LayoutDashboard, Users, Timer, Activity, Package, BarChart3, Trophy, Award, TrendingUp, TrendingDown, Printer, FileText, CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useTotalPartsUsedToday, useProducts } from "@/hooks/useStock";
import { useMachines } from "@/hooks/useMachines";
import { useEngineerScores } from "@/hooks/useEngineerScores";
import { useAllWoMetrics } from "@/hooks/useWoMetrics";
import { differenceInMinutes, format, subDays, startOfDay, endOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

const DONE_STATUSES = ["completed", "closed", "finished"];
const SLA_TARGETS: Record<string, number> = { low: 120, medium: 60, high: 30, critical: 10 };
const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#10b981", "#6b7280"];

const truncLabel = (s: string, max = 20) => s.length > max ? s.slice(0, max - 1) + "…" : s;

const EmptyChart = () => (
  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
    <BarChart3 className="h-8 w-8 mb-2 opacity-50" />
    <p className="text-sm">No data available</p>
  </div>
);

type PeriodPreset = "7d" | "30d" | "90d" | "custom";

export default function AnalyticsPage() {
  const { role } = useAuth();
  const { toast } = useToast();
  const [period, setPeriod] = useState<PeriodPreset>("30d");
  const [startDate, setStartDate] = useState<Date>(startOfDay(subDays(new Date(), 30)));
  const [endDate, setEndDate] = useState<Date>(endOfDay(new Date()));

  const handlePeriodChange = (val: PeriodPreset) => {
    setPeriod(val);
    if (val !== "custom") {
      const days = val === "7d" ? 7 : val === "30d" ? 30 : 90;
      setStartDate(startOfDay(subDays(new Date(), days)));
      setEndDate(endOfDay(new Date()));
    }
  };

  const { data: rawWOs, isLoading: woLoading } = useWorkOrders();
  const { data: partsToday } = useTotalPartsUsedToday();
  const { data: products, isLoading: productsLoading } = useProducts();
  const { data: machines, isLoading: machinesLoading } = useMachines();
  const { data: engineerScores, isLoading: scoresLoading } = useEngineerScores();
  const { data: woMetricsRange, isLoading: metricsLoading } = useAllWoMetrics({ from: startDate, to: endDate });

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
      const { count, error } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const today = new Date().toDateString();
  const openCount = allWOs?.filter((w) => w.status === "open").length ?? 0;
  const inProgressCount = allWOs?.filter((w) => w.status === "in_progress").length ?? 0;
  const completedToday = allWOs?.filter((w) => DONE_STATUSES.includes(w.status) && (w.closed_at || w.completed_at || w.finished_at) && new Date(w.closed_at || w.completed_at || w.finished_at!).toDateString() === today).length ?? 0;
  const lowStockCount = products?.filter((p) => p.quantity <= p.min_stock).length ?? 0;
  const hasNoActivity = !woLoading && !!rawWOs && (allWOs?.length ?? 0) === 0;

  // Single source of truth: derive avgResponse / avgMTTR from v_wo_metrics view.
  // MTBF still computed locally from creation timestamps (no equivalent view column).
  const kpis = useMemo(() => {
    const metrics = woMetricsRange ?? [];
    const respVals = metrics.map((m) => m.response_time_sec).filter((v): v is number => typeof v === "number" && v >= 0);
    const repairVals = metrics.map((m) => m.active_repair_sec).filter((v): v is number => typeof v === "number" && v >= 0);
    const avgResponse = respVals.length ? Math.round(respVals.reduce((a, b) => a + b, 0) / respVals.length / 60) : 0;
    const avgMTTR = repairVals.length ? Math.round(repairVals.reduce((a, b) => a + b, 0) / repairVals.length / 60) : 0;

    let mtbf = 0;
    if (allWOs && allWOs.length > 1) {
      const byMachine: Record<string, Date[]> = {};
      allWOs.forEach((w) => {
        if (!byMachine[w.machine]) byMachine[w.machine] = [];
        byMachine[w.machine].push(new Date(w.created_at));
      });
      let totalGaps = 0, gapCount = 0;
      Object.values(byMachine).forEach((dates) => {
        if (dates.length < 2) return;
        const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
        for (let i = 1; i < sorted.length; i++) {
          totalGaps += differenceInMinutes(sorted[i], sorted[i - 1]);
          gapCount++;
        }
      });
      mtbf = gapCount ? Math.round(totalGaps / gapCount) : 0;
    }
    return { avgResponse, avgMTTR, avgMTBF: mtbf };
  }, [allWOs, woMetricsRange]);

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
    allWOs.forEach((w) => { lc[w.machine] = (lc[w.machine] || 0) + 1; });
    return Object.entries(lc).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([machine, count]) => ({ machine, count }));
  }, [allWOs]);

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

  const downtimeByMachine = useMemo(() => {
    if (!allWOs) return [];
    const map: Record<string, number> = {};
    allWOs.filter((w) => DONE_STATUSES.includes(w.status)).forEach((wo) => {
      const m = metricsById.get(wo.id);
      if (!m || typeof m.active_repair_sec !== "number") return;
      const repair = m.active_repair_sec / 60;
      map[wo.machine] = (map[wo.machine] || 0) + repair;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([machine, minutes]) => ({ machine, minutes: Math.round(minutes) }));
  }, [allWOs, metricsById]);

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
      <div className="space-y-6">
        {/* Print Header — visible only when printing */}
        <div className="hidden print:block mb-6">
          <div className="flex items-center justify-between border-b-2 border-black pb-3">
            <div className="flex items-center gap-3">
              <img src={appliedLogo} alt="Applied Nutrition" className="h-12 w-12 object-contain" />
              <div>
                <h1 className="text-xl font-bold">AN MAINTENANCE</h1>
                <p className="text-sm text-muted-foreground">Applied Nutrition Ltd.</p>
              </div>
            </div>
            <div className="text-right">
              <h2 className="text-lg font-bold">ANALYTICS REPORT</h2>
              <p className="text-sm">Period: {format(startDate, "dd/MM/yyyy")} — {format(endDate, "dd/MM/yyyy")}</p>
              <p className="text-xs text-muted-foreground">Printed: {format(new Date(), "dd/MM/yyyy HH:mm")}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between print:hidden">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6" /> Analytics</h2>
            <p className="text-muted-foreground">KPIs, charts, and performance metrics</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => {
              if (role !== "admin" && role !== "manager") {
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
        <div className="flex items-center gap-3 flex-wrap print:hidden">
          <Select value={period} onValueChange={(v) => handlePeriodChange(v as PeriodPreset)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("w-[140px] justify-start text-left font-normal", !startDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(startDate, "dd/MM/yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={startDate} onSelect={(d) => { if (d) { setStartDate(startOfDay(d)); setPeriod("custom"); } }} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <span className="text-muted-foreground text-sm">to</span>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className={cn("w-[140px] justify-start text-left font-normal", !endDate && "text-muted-foreground")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(endDate, "dd/MM/yyyy")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar mode="single" selected={endDate} onSelect={(d) => { if (d) { setEndDate(endOfDay(d)); setPeriod("custom"); } }} initialFocus className="p-3 pointer-events-auto" />
            </PopoverContent>
          </Popover>
          <Badge variant="secondary" className="text-xs">{allWOs?.length ?? 0} WOs in range</Badge>
        </div>

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
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Open WOs</CardTitle><ClipboardList className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{openCount}</div>{hasNoActivity && <p className="text-xs text-muted-foreground mt-1">No activity in selected period</p>}</CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">In Progress</CardTitle><LayoutDashboard className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{inProgressCount}</div>{hasNoActivity && <p className="text-xs text-muted-foreground mt-1">No activity in selected period</p>}</CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Completed Today</CardTitle><ClipboardList className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{completedToday}</div>{hasNoActivity && <p className="text-xs text-muted-foreground mt-1">No activity in selected period</p>}</CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Users</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{userCount ?? 0}</div></CardContent></Card>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Avg Response</CardTitle><Timer className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.avgResponse} min</div>{hasNoActivity && <p className="text-xs text-muted-foreground mt-1">No activity in selected period</p>}</CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Avg MTTR</CardTitle><Activity className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.avgMTTR} min</div>{hasNoActivity && <p className="text-xs text-muted-foreground mt-1">No activity in selected period</p>}</CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Avg MTBF</CardTitle><Activity className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.avgMTBF > 60 ? `${Math.round(kpis.avgMTBF / 60)}h` : `${kpis.avgMTBF} min`}</div><p className="text-xs text-muted-foreground">{hasNoActivity ? "No activity in selected period" : "Mean Time Between Failures"}</p></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">SLA Compliance</CardTitle><Timer className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className={`text-2xl font-bold ${slaCompliance.rate < 80 ? "text-destructive" : "text-green-600"}`}>{slaCompliance.rate}%</div>{hasNoActivity && <p className="text-xs text-muted-foreground mt-1">No activity in selected period</p>}</CardContent></Card>
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
                    <Pie data={ordersByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine>
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
                    <Tooltip /><Legend />
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
                      <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                        {data.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i % STATUS_COLORS.length]} />)}
                      </Pie>
                      <Tooltip /><Legend />
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
                  <BarChart data={lineProblems} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="machine" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} /></BarChart>
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
                  <BarChart data={topProblems} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="problem" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} /></BarChart>
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
            <CardHeader><CardTitle className="text-base">Machines with Most Downtime</CardTitle></CardHeader>
            <CardContent>
              {!downtimeByMachine.length ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={downtimeByMachine} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="machine" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip formatter={(v: number) => `${v} min`} /><Bar dataKey="minutes" fill="#ef4444" name="Downtime (min)" radius={[0, 4, 4, 0]} /></BarChart>
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
                          <td className="px-3 py-2 text-center">{eng.avgResponse} min</td>
                          <td className="px-3 py-2 text-center">{eng.avgMTTR} min</td>
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
      </div>
    </DashboardLayout>
  );
}
