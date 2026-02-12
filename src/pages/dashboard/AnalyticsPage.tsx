import { useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, LayoutDashboard, Users, Timer, Activity, Package, AlertTriangle, BarChart3 } from "lucide-react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useTotalPartsUsedToday, useProducts } from "@/hooks/useStock";
import { differenceInMinutes, format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function AnalyticsPage() {
  const { data: allWOs } = useWorkOrders();
  const { data: partsToday } = useTotalPartsUsedToday();
  const { data: products } = useProducts();

  const { data: userCount } = useQuery({
    queryKey: ["user_count"],
    queryFn: async () => {
      const { count, error } = await supabase.from("profiles").select("*", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: partsByCategory } = useQuery({
    queryKey: ["parts_by_category"],
    queryFn: async () => {
      const { data, error } = await supabase.from("parts_used").select("quantity, product:products(category)");
      if (error) throw error;
      return data;
    },
  });

  const today = new Date().toDateString();
  const openCount = allWOs?.filter((w) => w.status === "open").length ?? 0;
  const inProgressCount = allWOs?.filter((w) => w.status === "in_progress").length ?? 0;
  const completedToday = allWOs?.filter((w) => w.status === "completed" && w.completed_at && new Date(w.completed_at).toDateString() === today).length ?? 0;
  const lowStockCount = products?.filter((p) => p.quantity <= p.min_stock).length ?? 0;

  const kpis = useMemo(() => {
    if (!allWOs) return { avgResponse: 0, avgMTTR: 0 };
    const completed = allWOs.filter((w) => w.status === "completed" && w.started_at && w.completed_at);
    let totalResp = 0, totalMTTR = 0, count = 0;
    completed.forEach((wo) => {
      totalResp += differenceInMinutes(new Date(wo.started_at!), new Date(wo.created_at));
      totalMTTR += differenceInMinutes(new Date(wo.completed_at!), new Date(wo.started_at!));
      count++;
    });
    return { avgResponse: count ? Math.round(totalResp / count) : 0, avgMTTR: count ? Math.round(totalMTTR / count) : 0 };
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

  const topMachines = useMemo(() => {
    if (!allWOs) return [];
    const mc: Record<string, number> = {};
    allWOs.forEach((w) => { mc[w.machine] = (mc[w.machine] || 0) + 1; });
    return Object.entries(mc).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([machine, count]) => ({ machine, count }));
  }, [allWOs]);

  const topProblems = useMemo(() => {
    if (!allWOs) return [];
    const pc: Record<string, number> = {};
    allWOs.forEach((w) => { pc[w.description] = (pc[w.description] || 0) + 1; });
    return Object.entries(pc).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([problem, count]) => ({ problem, count }));
  }, [allWOs]);

  const partsCategoryChart = useMemo(() => {
    if (!partsByCategory) return [];
    const cats: Record<string, number> = {};
    partsByCategory.forEach((pu: any) => {
      const cat = pu.product?.category || "Unknown";
      cats[cat] = (cats[cat] || 0) + pu.quantity;
    });
    return Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }));
  }, [partsByCategory]);

  // Engineer performance
  const engineerPerformance = useMemo(() => {
    if (!allWOs) return [];
    const engineers: Record<string, { name: string; completed: number; totalResp: number; totalMTTR: number }> = {};
    allWOs.filter((w) => w.status === "completed" && w.engineer_id && w.started_at && w.completed_at).forEach((wo) => {
      const eid = wo.engineer_id!;
      const name = wo.engineer?.name || "Unknown";
      if (!engineers[eid]) engineers[eid] = { name, completed: 0, totalResp: 0, totalMTTR: 0 };
      engineers[eid].completed++;
      engineers[eid].totalResp += differenceInMinutes(new Date(wo.started_at!), new Date(wo.created_at));
      engineers[eid].totalMTTR += differenceInMinutes(new Date(wo.completed_at!), new Date(wo.started_at!));
    });
    return Object.values(engineers).map((e) => ({
      name: e.name,
      completed: e.completed,
      avgResponse: Math.round(e.totalResp / e.completed),
      avgMTTR: Math.round(e.totalMTTR / e.completed),
    })).sort((a, b) => b.completed - a.completed);
  }, [allWOs]);

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
          <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Parts Today</CardTitle><Package className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{partsToday ?? 0}</div></CardContent></Card>
          <Card className={lowStockCount > 0 ? "border-destructive" : ""}><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Low Stock</CardTitle><AlertTriangle className={`h-4 w-4 ${lowStockCount > 0 ? "text-destructive" : "text-muted-foreground"}`} /></CardHeader><CardContent><div className={`text-2xl font-bold ${lowStockCount > 0 ? "text-destructive" : ""}`}>{lowStockCount}</div></CardContent></Card>
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
            <CardHeader><CardTitle className="text-base">Top 5 Machines</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={topMachines} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="machine" width={120} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} /></BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Top 5 Problems</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={topProblems} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="problem" width={120} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} /></BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Parts Used by Category</CardTitle></CardHeader>
            <CardContent>
              {!partsCategoryChart.length ? (
                <p className="text-muted-foreground text-sm text-center py-8">No parts usage data.</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={partsCategoryChart} layout="vertical"><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="category" width={120} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--warning))" radius={[0, 4, 4, 0]} /></BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Engineer Performance */}
        <Card>
          <CardHeader><CardTitle className="text-base">Engineer Performance</CardTitle></CardHeader>
          <CardContent>
            {!engineerPerformance.length ? (
              <p className="text-muted-foreground text-sm text-center py-8">No completed work orders with engineer data yet.</p>
            ) : (
              <div className="space-y-6">
                <ResponsiveContainer width="100%" height={Math.max(200, engineerPerformance.length * 50)}>
                  <BarChart data={engineerPerformance} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="name" width={120} />
                    <Tooltip />
                    <Bar dataKey="completed" fill="hsl(var(--primary))" name="Completed WOs" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {engineerPerformance.map((eng) => (
                    <Card key={eng.name} className="border">
                      <CardContent className="pt-4">
                        <p className="font-medium">{eng.name}</p>
                        <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                          <div><p className="text-muted-foreground text-xs">Completed</p><p className="font-bold">{eng.completed}</p></div>
                          <div><p className="text-muted-foreground text-xs">Avg Response</p><p className="font-bold">{eng.avgResponse} min</p></div>
                          <div><p className="text-muted-foreground text-xs">Avg MTTR</p><p className="font-bold">{eng.avgMTTR} min</p></div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
