import { useMemo } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, Factory, Wrench } from "lucide-react";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useProducts } from "@/hooks/useStock";
import { useMachines } from "@/hooks/useMachines";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { differenceInHours, differenceInMinutes, startOfDay, startOfMonth, format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const DONE_STATUSES = ["completed", "closed", "finished", "force_closed"];

export default function FinancialDashboard() {
  const { data: allWOs } = useWorkOrders();
  const { data: products } = useProducts();
  const { data: machines } = useMachines();

  // Fetch all parts_used with product price
  const { data: allPartsUsed } = useQuery({
    queryKey: ["all_parts_used_with_price"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parts_used")
        .select("*, product:products(name, code, price)");
      if (error) throw error;
      return data as any[];
    },
  });

  // Fetch engineer labor rates
  const { data: profiles } = useQuery({
    queryKey: ["profiles_labor_rates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, labor_rate");
      if (error) throw error;
      return data as { id: string; name: string; labor_rate: number }[];
    },
  });

  const machineLineMap = useMemo(() => {
    const map: Record<string, string> = {};
    machines?.forEach((m) => { map[m.name] = m.line || "Unknown"; });
    return map;
  }, [machines]);

  const laborRateMap = useMemo(() => {
    const map: Record<string, number> = {};
    profiles?.forEach((p) => { map[p.id] = p.labor_rate || 0; });
    return map;
  }, [profiles]);

  // Calculate costs per WO
  const woCosts = useMemo(() => {
    if (!allWOs || !allPartsUsed) return [];
    return allWOs.filter(w => DONE_STATUSES.includes(w.status) && w.started_at && w.finished_at).map((wo) => {
      const woParts = allPartsUsed.filter((p) => p.work_order_id === wo.id);
      const partsCost = woParts.reduce((sum, p) => sum + (p.product?.price || 0) * p.quantity, 0);

      const repairHours = differenceInMinutes(new Date(wo.finished_at!), new Date(wo.started_at!)) / 60;
      const rate = wo.engineer_id ? laborRateMap[wo.engineer_id] || 0 : 0;
      const laborCost = repairHours * rate;

      const overtimeHours = Math.max(0, repairHours - 8);
      const overtimeCost = overtimeHours * rate * 0.5; // extra 50%

      const totalCost = partsCost + laborCost + overtimeCost;

      return {
        id: wo.id,
        wo_number: wo.wo_number,
        machine: wo.machine,
        line: machineLineMap[wo.machine] || "Unknown",
        description: wo.description,
        created_at: wo.created_at,
        partsCost,
        laborCost,
        overtimeCost,
        totalCost,
        repairHours: Math.round(repairHours * 10) / 10,
      };
    });
  }, [allWOs, allPartsUsed, laborRateMap, machineLineMap]);

  const now = new Date();
  const todayCost = woCosts.filter(w => new Date(w.created_at) >= startOfDay(now)).reduce((s, w) => s + w.totalCost, 0);
  const monthCost = woCosts.filter(w => new Date(w.created_at) >= startOfMonth(now)).reduce((s, w) => s + w.totalCost, 0);
  const totalParts = woCosts.reduce((s, w) => s + w.partsCost, 0);
  const totalLabor = woCosts.reduce((s, w) => s + w.laborCost, 0);

  // Cost by machine
  const costByMachine = useMemo(() => {
    const map: Record<string, number> = {};
    woCosts.forEach((w) => { map[w.machine] = (map[w.machine] || 0) + w.totalCost; });
    return Object.entries(map).map(([name, cost]) => ({ name, cost: Math.round(cost * 100) / 100 })).sort((a, b) => b.cost - a.cost).slice(0, 10);
  }, [woCosts]);

  // Cost by line
  const costByLine = useMemo(() => {
    const map: Record<string, number> = {};
    woCosts.forEach((w) => { map[w.line] = (map[w.line] || 0) + w.totalCost; });
    return Object.entries(map).map(([name, cost]) => ({ name, cost: Math.round(cost * 100) / 100 })).sort((a, b) => b.cost - a.cost);
  }, [woCosts]);

  const fmt = (v: number) => `£${v.toFixed(2)}`;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="h-6 w-6" /> Financial Dashboard</h2>
          <p className="text-muted-foreground">Cost tracking and financial analysis</p>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Today's Cost</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{fmt(todayCost)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Monthly Cost</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{fmt(monthCost)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Parts Cost</CardTitle>
              <Wrench className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{fmt(totalParts)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Labor Cost</CardTitle>
              <Factory className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{fmt(totalLabor)}</div></CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Cost by Machine (Top 10)</CardTitle></CardHeader>
            <CardContent>
              {costByMachine.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={costByMachine} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(v) => `£${v}`} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => [`£${v.toFixed(2)}`, "Cost"]} />
                    <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-muted-foreground text-center py-8">No cost data yet</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Cost by Line</CardTitle></CardHeader>
            <CardContent>
              {costByLine.length ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={costByLine}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `£${v}`} />
                    <Tooltip formatter={(v: number) => [`£${v.toFixed(2)}`, "Cost"]} />
                    <Bar dataKey="cost" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-muted-foreground text-center py-8">No cost data yet</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Work Order Cost Breakdown</CardTitle></CardHeader>
          <CardContent>
            {!woCosts.length ? (
              <p className="text-muted-foreground text-center py-8">No completed work orders with cost data.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>WO#</TableHead>
                    <TableHead>Line</TableHead>
                    <TableHead>Machine</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Parts Cost</TableHead>
                    <TableHead>Labor Cost</TableHead>
                    <TableHead>Overtime</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {woCosts.slice(0, 50).map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-mono font-medium">WO-{String(w.wo_number).padStart(4, "0")}</TableCell>
                      <TableCell>{w.line}</TableCell>
                      <TableCell>{w.machine}</TableCell>
                      <TableCell>{w.repairHours}h</TableCell>
                      <TableCell>{fmt(w.partsCost)}</TableCell>
                      <TableCell>{fmt(w.laborCost)}</TableCell>
                      <TableCell>{w.overtimeCost > 0 ? <Badge variant="destructive">{fmt(w.overtimeCost)}</Badge> : "—"}</TableCell>
                      <TableCell className="font-bold">{fmt(w.totalCost)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
