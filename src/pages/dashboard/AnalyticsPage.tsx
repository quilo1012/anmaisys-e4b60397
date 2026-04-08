import { useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, LayoutDashboard, Users, Timer, Activity, Package, BarChart3, Trophy, Award, TrendingUp, TrendingDown } from "lucide-react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useTotalPartsUsedToday, useProducts } from "@/hooks/useStock";
import { useMachines } from "@/hooks/useMachines";
import { useEngineerScores } from "@/hooks/useEngineerScores";
import { differenceInMinutes, format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

const DONE_STATUSES = ["completed", "closed", "finished"];
const SLA_TARGETS: Record<string, number> = { low: 120, medium: 60, high: 30, critical: 10 };
const COLORS = ["hsl(var(--primary))", "hsl(var(--accent))", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#10b981", "#6b7280"];

const truncLabel = (s: string, max = 20) => s.length > max ? s.slice(0, max - 1) + "…" : s;

export default function AnalyticsPage() {
  const { data: allWOs } = useWorkOrders();
  const { data: partsToday } = useTotalPartsUsedToday();
  const { data: products } = useProducts();
  const { data: machines } = useMachines();
  const { data: engineerScores } = useEngineerScores();

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

  const kpis = useMemo(() => {
    if (!allWOs) return { avgResponse: 0, avgMTTR: 0, avgMTBF: 0 };
    const done = allWOs.filter((w) => DONE_STATUSES.includes(w.status) && w.started_at);
    let totalResp = 0, totalMTTR = 0, count = 0;
    done.forEach((wo) => {
      totalResp += differenceInMinutes(new Date(wo.started_at!), new Date(wo.created_at));
      const end = wo.finished_at || wo.completed_at;
      if (end) { totalMTTR += differenceInMinutes(new Date(end), new Date(wo.started_at!)); }
      count++;
    });
    // MTBF: avg time between failures per machine
    let mtbf = 0;
    if (allWOs.length > 1) {
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
    return { avgResponse: count ? Math.round(totalResp / count) : 0, avgMTTR: count ? Math.round(totalMTTR / count) : 0, avgMTBF: mtbf };
  }, [allWOs]);

  const wosPerDay = useMemo(() => {
    if (!allWOs) return [];
    const days: { date: string; count: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = subDays(new Date(), i);
      days.push({ date: format(d, "dd/MM"), count: allWOs.filter((w) => new Date(w.created_at).toDateString() === d.toDateString()).length });
    }
    return days;
  }, [allWOs]);

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

  const slaCompliance = useMemo(() => {
    if (!allWOs) return { rate: 0, total: 0, met: 0 };
    const relevant = allWOs.filter((w) => DONE_STATUSES.includes(w.status) && w.received_at);
    let met = 0;
    relevant.forEach((wo) => {
      const target = SLA_TARGETS[wo.priority || "medium"] || 60;
      const responseMin = differenceInMinutes(new Date(wo.received_at!), new Date(wo.created_at));
      if (responseMin <= target) met++;
    });
    return { rate: relevant.length ? Math.round((met / relevant.length) * 100) : 0, total: relevant.length, met };
  }, [allWOs]);

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
    allWOs.filter((w) => DONE_STATUSES.includes(w.status) && w.started_at && (w.finished_at || w.completed_at)).forEach((wo) => {
      const repair = differenceInMinutes(new Date(wo.finished_at || wo.completed_at!), new Date(wo.started_at!));
      map[wo.machine] = (map[wo.machine] || 0) + repair;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([machine, minutes]) => ({ machine, minutes }));
  }, [allWOs]);

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
    const engineers: Record<string, { name: string; completed: number; totalResp: number; totalMTTR: number }> = {};
    allWOs.filter((w) => DONE_STATUSES.includes(w.status) && w.engineer_id && w.started_at).forEach((wo) => {
      const eid = wo.engineer_id!;
      const name = wo.engineer_name || wo.engineer?.name || "Unknown";
      if (!engineers[eid]) engineers[eid] = { name, completed: 0, totalResp: 0, totalMTTR: 0 };
      engineers[eid].completed++;
      engineers[eid].totalResp += differenceInMinutes(new Date(wo.started_at!), new Date(wo.created_at));
      const end = wo.finished_at || wo.completed_at;
      if (end) engineers[eid].totalMTTR += differenceInMinutes(new Date(end), new Date(wo.started_at!));
    });
    return Object.values(engineers).map((e) => ({
      name: e.name,
      completed: e.completed,
      avgResponse: Math.round(e.totalResp / e.completed),
      avgMTTR: Math.round(e.totalMTTR / e.completed),
    })).sort((a, b) => b.completed - a.completed);
  }, [allWOs]);


  // Merge ranking with scores
  const rankedEngineers = useMemo(() => {
    const scoreMap: Record<string, number> = {};
    engineerScores?.forEach((s) => { scoreMap[s.engineer_name || ""] = s.score; });
    return engineerPerformance.map((e) => ({ ...e, score: scoreMap[e.name] ?? 0 })).sort((a, b) => b.score - a.score);
  }, [engineerPerformance, engineerScores]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="h-6 w-6" /> Analytics</h2>
          <p className="text-muted-foreground">KPIs, charts, and performance metrics</p>
        </div>

        {/* KPI cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Open WOs</CardTitle><ClipboardList className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{openCount}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">In Progress</CardTitle><LayoutDashboard className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{inProgressCount}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Completed Today</CardTitle><ClipboardList className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{completedToday}</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Users</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{userCount ?? "—"}</div></CardContent></Card>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Avg Response</CardTitle><Timer className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.avgResponse} min</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Avg MTTR</CardTitle><Activity className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.avgMTTR} min</div></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Avg MTBF</CardTitle><Activity className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{kpis.avgMTBF > 60 ? `${Math.round(kpis.avgMTBF / 60)}h` : `${kpis.avgMTBF} min`}</div><p className="text-xs text-muted-foreground">Mean Time Between Failures</p></CardContent></Card>
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">SLA Compliance</CardTitle><Timer className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className={`text-2xl font-bold ${slaCompliance.rate < 80 ? "text-destructive" : "text-green-600"}`}>{slaCompliance.rate}%</div></CardContent></Card>
        </div>

        {/* Charts */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">WOs per Day (Last 7 Days)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={wosPerDay}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Orders by Status</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie data={ordersByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine>
                    {ordersByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
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
                  machines.forEach((m) => { machineTypeMap[m.name] = m.machine_type || "Unknown"; });
                  allWOs.forEach((w) => {
                    const t = machineTypeMap[w.machine] || "Unknown";
                    wosByType[t] = (wosByType[t] || 0) + 1;
                  });
                }
                const data = Object.entries(wosByType).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => ({ type, count }));
                return !data.length ? (
                  <p className="text-muted-foreground text-sm text-center py-8">No data yet.</p>
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
                  <p className="text-muted-foreground text-sm text-center py-8">No machines yet.</p>
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
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={lineProblems} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="machine" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} /></BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Top 5 Problems</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={topProblems} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="problem" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => truncLabel(v)} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} /></BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Orders by Priority</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={ordersByPriority}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="priority" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Machines with Most Downtime</CardTitle></CardHeader>
            <CardContent>
              {!downtimeByMachine.length ? (
                <p className="text-muted-foreground text-sm text-center py-8">No downtime data yet.</p>
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
                <p className="text-muted-foreground text-sm text-center py-8">No data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={mostUsedMachines} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="machine" width={140} tick={{ fontSize: 11 }}  /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" name="Total WOs" radius={[0, 4, 4, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Maintenance Frequency (avg WOs/month)</CardTitle></CardHeader>
            <CardContent>
              {!maintenanceFrequency.length ? (
                <p className="text-muted-foreground text-sm text-center py-8">No data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={maintenanceFrequency} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="machine" width={140} tick={{ fontSize: 11 }}  /><Tooltip /><Bar dataKey="avgPerMonth" fill="hsl(var(--accent))" name="Avg/Month" radius={[0, 4, 4, 0]} /></BarChart>
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
              <p className="text-muted-foreground text-sm text-center py-8">No completed work orders with engineer data yet.</p>
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
