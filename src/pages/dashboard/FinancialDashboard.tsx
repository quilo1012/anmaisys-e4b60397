import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, TrendingUp, Factory, Wrench, ShieldAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useProducts } from "@/hooks/useStock";
import { useMachines } from "@/hooks/useMachines";
import { useRole } from "@/hooks/useRole";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { differenceInMinutes, startOfDay, endOfDay, subDays } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { DateRangePreset, DateRange, getPresetRange } from "@/components/DateRangeFilter";
import { resolveLine as resolveLineShared } from "@/lib/resolveLine";
import { ReportsFilterBar } from "@/components/reports/ReportsFilterBar";
import { KpiCard } from "@/components/reports/KpiCard";
import { ReportPrintHeader } from "@/components/reports/ReportPrintHeader";
import { EmptyState } from "@/components/EmptyState";
import { format } from "date-fns";
import { Inbox } from "lucide-react";

type PeriodPreset = "7d" | "30d" | "90d" | "custom";

const DONE_STATUSES = ["completed", "closed", "finished", "force_closed"];

export default function FinancialDashboard() {
  const { role, loading: roleLoading } = useRole();

  // Defense-in-depth role guard — runs before any data hooks fire.
  if (roleLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      </DashboardLayout>
    );
  }
  if (role !== "admin" && (role !== "manager" && role !== "maintenance_manager")) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <ShieldAlert className="h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold">Access Denied</h1>
          <p className="text-muted-foreground text-sm max-w-md">
            The Financial Dashboard is restricted to admins and managers.
          </p>
          <Button asChild variant="outline">
            <Link to="/">Go back</Link>
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  return <FinancialDashboardContent />;
}

function FinancialDashboardContent() {
  const { data: allWOs } = useWorkOrders();
  const { data: products } = useProducts();
  const { data: machines } = useMachines();

  const [drPreset, setDrPreset] = useState<DateRangePreset>("30d");
  const [drRange, setDrRange] = useState<DateRange>(() => getPresetRange("30d"));
  const startDate = drRange.from ?? startOfDay(subDays(new Date(), 30));
  const endDate = drRange.to ?? endOfDay(new Date());

  // Fallback labor rate applied whenever a specific engineer has no rate
  // configured. Persisted locally so a manager can tune the estimate
  // without editing every engineer record. Defaults to £30/h.
  const [fallbackRate, setFallbackRate] = useState<number>(() => {
    const stored = Number(localStorage.getItem("financial:fallback_rate") || "30");
    return Number.isFinite(stored) && stored >= 0 ? stored : 30;
  });

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

  // Fetch engineer labor rates via admin/manager SECURITY DEFINER RPC.
  // work_orders.engineer_id references public.engineers (standalone), NOT profiles.
  const { data: profiles } = useQuery({
    queryKey: ["engineer_labor_rates"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("list_engineer_labor_rates");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        name: r.name,
        labor_rate: Number(r.labor_rate) || 0,
      }));
    },
  });

  const resolveLine = (wo: any): string => resolveLineShared(wo, machines);

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
      const engineerRate = wo.engineer_id ? laborRateMap[wo.engineer_id] || 0 : 0;
      const rate = engineerRate > 0 ? engineerRate : fallbackRate; // fall back to configurable rate
      const laborCost = repairHours * rate;

      const overtimeHours = Math.max(0, repairHours - 8);
      const overtimeCost = overtimeHours * rate * 0.5; // extra 50%

      const totalCost = partsCost + laborCost + overtimeCost;

      return {
        id: wo.id,
        wo_number: wo.wo_number,
        machine: wo.machine,
        line: resolveLine(wo),
        description: wo.description,
        created_at: wo.created_at,
        partsCost,
        laborCost,
        overtimeCost,
        totalCost,
        repairHours: Math.round(repairHours * 10) / 10,
      };
    });
  }, [allWOs, allPartsUsed, laborRateMap, machines, fallbackRate]);

  // Filter WO costs by selected date range
  const filteredCosts = useMemo(
    () => woCosts.filter((w) => {
      const d = new Date(w.created_at);
      return d >= startDate && d <= endDate;
    }),
    [woCosts, startDate, endDate]
  );

  const now = new Date();
  const todayCost = filteredCosts.filter(w => new Date(w.created_at) >= startOfDay(now)).reduce((s, w) => s + w.totalCost, 0);
  const periodCost = filteredCosts.reduce((s, w) => s + w.totalCost, 0);
  const totalParts = filteredCosts.reduce((s, w) => s + w.partsCost, 0);
  const totalLabor = filteredCosts.reduce((s, w) => s + w.laborCost, 0);

  // Cost by machine
  const costByMachine = useMemo(() => {
    const map: Record<string, number> = {};
    filteredCosts.forEach((w) => { map[w.machine] = (map[w.machine] || 0) + w.totalCost; });
    return Object.entries(map).map(([name, cost]) => ({ name, cost: Math.round(cost * 100) / 100 })).sort((a, b) => b.cost - a.cost).slice(0, 10);
  }, [filteredCosts]);

  // Cost by line
  const costByLine = useMemo(() => {
    const map: Record<string, number> = {};
    filteredCosts.forEach((w) => { map[w.line] = (map[w.line] || 0) + w.totalCost; });
    return Object.entries(map).map(([name, cost]) => ({ name, cost: Math.round(cost * 100) / 100 })).sort((a, b) => b.cost - a.cost);
  }, [filteredCosts]);

  const stockValue = useMemo(() => {
    if (!products) return 0;
    return products.reduce((sum, p) => sum + (p.price || 0) * p.quantity, 0);
  }, [products]);

  const fmt = (v: number) => `£${v.toFixed(2)}`;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <ReportPrintHeader
          title="Financial Dashboard"
          periodLabel={`${format(startDate, "dd/MM/yyyy HH:mm")} — ${format(endDate, "dd/MM/yyyy HH:mm")}`}
        />

        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="h-6 w-6" /> Financial Dashboard</h2>
            <p className="text-muted-foreground">Cost tracking and financial analysis</p>
          </div>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            Fallback £/h
            <input
              type="number"
              min={0}
              step={1}
              value={fallbackRate}
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0);
                setFallbackRate(v);
                localStorage.setItem("financial:fallback_rate", String(v));
              }}
              className="w-20 h-9 rounded-md border bg-background px-2 text-sm"
              title="Applied when an engineer has no labor rate set"
            />
          </label>
        </div>

        <ReportsFilterBar
          dateRange={drRange}
          datePreset={drPreset}
          onDateChange={(r, p) => { setDrRange(r); setDrPreset(p); }}
          storageKey="financial-dashboard"
        />

        <div className="grid gap-4 md:grid-cols-5">
          <KpiCard accent="green" icon={<DollarSign className="h-4 w-4" />} label="Today's Cost" value={fmt(todayCost)} valueClassName="text-2xl" />
          <KpiCard accent="blue" icon={<TrendingUp className="h-4 w-4" />} label="Period Cost" value={fmt(periodCost)} valueClassName="text-2xl" />
          <KpiCard accent="amber" icon={<Wrench className="h-4 w-4" />} label="Total Parts Cost" value={fmt(totalParts)} valueClassName="text-2xl" />
          <KpiCard accent="indigo" icon={<Factory className="h-4 w-4" />} label="Total Labor Cost" value={fmt(totalLabor)} valueClassName="text-2xl" />
          <KpiCard accent="purple" icon={<Wrench className="h-4 w-4" />} label="Stock Inventory Value" value={fmt(stockValue)} valueClassName="text-2xl text-primary" />
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Cost by Machine (Top 10)</CardTitle></CardHeader>
            <CardContent>
              {costByMachine.some((c) => c.cost > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={costByMachine} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tickFormatter={(v) => `£${v}`} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => [`£${v.toFixed(2)}`, "Cost"]} />
                    <Bar dataKey="cost" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-muted-foreground text-center py-8">No cost data for this period</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Cost by Line</CardTitle></CardHeader>
            <CardContent>
              {costByLine.some((c) => c.cost > 0) ? (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={costByLine}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `£${v}`} />
                    <Tooltip formatter={(v: number) => [`£${v.toFixed(2)}`, "Cost"]} />
                    <Bar dataKey="cost" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-muted-foreground text-center py-8">No cost data for this period</p>}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Work Order Cost Breakdown</CardTitle></CardHeader>
          <CardContent>
            {!filteredCosts.length ? (
              <p className="text-muted-foreground text-center py-8">No completed work orders with cost data in this date range.</p>
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
                  {filteredCosts.slice(0, 50).map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-mono font-medium">WO-{new Date(w.created_at).getFullYear()}-{String(w.wo_number).padStart(6, "0")}</TableCell>
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
