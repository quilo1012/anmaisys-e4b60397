import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, LayoutDashboard, Timer, Activity, Package, AlertTriangle, BarChart3, Cog, AlertCircle, Loader2, Lock, Plus, ExternalLink, Monitor, Clock, Wrench, PowerOff, TrendingDown } from "lucide-react";
import { formatMinutes } from "@/lib/formatDuration";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useTotalPartsUsedToday, useProducts } from "@/hooks/useStock";
import { useAllWoMetrics } from "@/hooks/useWoMetrics";
import { differenceInMinutes } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { invokeFunction } from "@/lib/invokeFunction";
import { useNavigate, Navigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWOAlerts } from "@/hooks/useWOAlerts";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ManagerNavCards } from "@/components/DashboardNavCards";
import { KpiInfoTooltip } from "@/components/KpiInfoTooltip";
import { isWoOpen, countOpenWOs } from "@/lib/woStatus";
import { DateRangeFilter, DateRangePreset, DateRange, getPresetRange } from "@/components/DateRangeFilter";

const DONE_STATUSES = ["completed", "closed", "finished", "force_closed"];

type KpiTone = "blue" | "amber" | "green" | "red" | "muted";
const KPI_TONE: Record<KpiTone, string> = {
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  green: "bg-green-500/15 text-green-600 dark:text-green-400",
  red: "bg-red-500/15 text-red-600 dark:text-red-400",
  muted: "bg-muted text-muted-foreground",
};

function KpiCard({
  label,
  value,
  icon: Icon,
  tone,
  tooltip,
  footer,
  highlight,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  tone: KpiTone;
  tooltip: string;
  footer?: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-destructive" : ""}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</CardTitle>
          <KpiInfoTooltip text={tooltip} />
        </div>
        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${KPI_TONE[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold tabular-nums ${highlight ? "text-destructive" : ""}`}>{value}</div>
        {footer && <p className="text-xs text-muted-foreground mt-1">{footer}</p>}
      </CardContent>
    </Card>
  );
}

export default function ManagerDashboard() {
  const { role, loading: authLoading } = useAuth();

  // Defense-in-depth role guard — redirect unauthorized roles before any data hooks fire
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  // ProtectedRoute already enforces role access; if role is missing transiently, just wait
  if (!role) return null;
  if (role !== "admin" && role !== "manager") {
    return null;
  }

  return <ManagerDashboardContent />;
}

function ManagerDashboardContent() {
  const { data: allWOs } = useWorkOrders();
  const { data: partsToday } = useTotalPartsUsedToday();
  const { data: products } = useProducts();
  const [kpiPreset, setKpiPreset] = useState<DateRangePreset>("7d");
  const [kpiRange, setKpiRange] = useState<DateRange>(() => getPresetRange("7d"));
  const { data: woMetrics = [] } = useAllWoMetrics({ from: kpiRange.from, to: kpiRange.to });
  const { role } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [showChangePin, setShowChangePin] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  useWOAlerts();

  const today = new Date().toDateString();
  // "Open" = anything that is not in a terminal state (closed/finished/completed/force_closed)
  const openCount = countOpenWOs(allWOs);
  const inProgressCount = allWOs?.filter((w) => w.status === "in_progress").length ?? 0;
  const completedToday = allWOs?.filter((w) => DONE_STATUSES.includes(w.status) && (w.closed_at || w.completed_at || w.finished_at) && new Date(w.closed_at || w.completed_at || w.finished_at!).toDateString() === today).length ?? 0;
  const lowStockCount = products?.filter((p) => p.quantity <= p.min_stock).length ?? 0;

  // Three distinct labeled time KPIs from v_wo_metrics (single source of truth).
  // Only count truly finalized WOs (finished/closed/completed) — excludes force_closed
  // (which never had a real engineer cycle) and in-progress WOs (which have partial times).
  const kpis = useMemo(() => {
    const FINAL = new Set(["finished", "closed", "completed"]);
    const finalized = woMetrics.filter((m) => FINAL.has((m as any).status));

    const respM = finalized.filter((m) => m.response_time_sec !== null && (m.response_time_sec ?? 0) >= 0);
    const avgResponse = respM.length
      ? Math.round(respM.reduce((s, m) => s + (m.response_time_sec || 0), 0) / respM.length / 60)
      : 0;

    const repairM = finalized.filter((m) => m.active_repair_sec !== null && (m.active_repair_sec ?? 0) > 0);
    const avgActiveRepair = repairM.length
      ? Math.round(repairM.reduce((s, m) => s + (m.active_repair_sec || 0), 0) / repairM.length / 60)
      : 0;

    const downM = finalized.filter((m) => m.line_downtime_sec !== null && (m.line_downtime_sec ?? 0) > 0);
    const avgLineDowntime = downM.length
      ? Math.round(downM.reduce((s, m) => s + (m.line_downtime_sec || 0), 0) / downM.length / 60)
      : 0;

    const totalDowntimeMin = Math.round(
      finalized.reduce((s, m) => s + (m.line_downtime_sec || 0), 0) / 60
    );

    return { avgResponse, avgActiveRepair, avgLineDowntime, totalDowntimeMin };
  }, [woMetrics]);

  const handleChangePin = async () => {
    if (newPin.length < 4) {
      toast({ title: "PIN too short", description: "PIN must be at least 4 characters.", variant: "destructive" });
      return;
    }
    if (newPin !== confirmPin) {
      toast({ title: "PINs don't match", description: "Please confirm the new PIN.", variant: "destructive" });
      return;
    }
    setSavingPin(true);
    try {
      const { data, error } = await invokeFunction("update-admin-pin", { newPin });
      if (error) throw error;
      if (!data?.success) throw new Error("Failed to update PIN");
      toast({ title: "PIN updated", description: "The admin PIN has been changed successfully." });
      setShowChangePin(false);
      setNewPin("");
      setConfirmPin("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingPin(false);
    }
  };

  const dashTitle = role === "admin" ? "Admin Dashboard" : "Manager Dashboard";

  const quickLinks = [
    { title: "Analytics", desc: "Charts & performance", icon: BarChart3, url: "/dashboard/analytics" },
    { title: "Work Orders", desc: "Table & Kanban", icon: ClipboardList, url: "/dashboard/work-orders" },
    { title: "Machines", desc: "Manage machines", icon: Cog, url: "/dashboard/machines" },
    { title: "Problems", desc: "Problem descriptions", icon: AlertCircle, url: "/dashboard/problems" },
    { title: "Stock", desc: "Parts & inventory", icon: Package, url: "/dashboard/stock" },
    ...(role === "admin" ? [{ title: "Audit Logs", desc: "Activity history", icon: Activity, url: "/dashboard/audit-logs" }] : []),
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-end">
          <Button variant="outline" size="sm" onClick={() => setShowChangePin(true)}>
            <Lock className="h-4 w-4 mr-2" /> Change PIN
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
          <span className="text-sm font-medium text-muted-foreground">KPI period filter</span>
          <DateRangeFilter
            value={kpiRange}
            preset={kpiPreset}
            onChange={(r, p) => { setKpiRange(r); setKpiPreset(p); }}
          />
        </div>

        {/* Unified KPI grid: 8 cards in 2 rows of 4. Tablet (md) already shows 4 cols. */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-4 auto-rows-fr">
          <KpiCard
            label="Open WOs"
            value={openCount}
            icon={ClipboardList}
            tone="blue"
            tooltip="Open Work Orders: orders created that have not yet been accepted by an engineer. Shows the current backlog awaiting response."
          />
          <KpiCard
            label="In Progress"
            value={inProgressCount}
            icon={LayoutDashboard}
            tone="amber"
            tooltip="In Progress: orders already accepted by an engineer and being worked on (received, traveling, or under repair)."
          />
          <KpiCard
            label="Finished Today"
            value={completedToday}
            icon={ClipboardList}
            tone="green"
            tooltip="Finished Today: number of orders completed (finished/closed/completed) today. Daily productivity indicator."
          />
          <KpiCard
            label="Low Stock"
            value={lowStockCount}
            icon={AlertTriangle}
            tone={lowStockCount > 0 ? "red" : "muted"}
            tooltip="Low Stock: number of products whose on-hand quantity is at or below the defined minimum. Restocking required."
            highlight={lowStockCount > 0}
          />

          <KpiCard
            label="Avg Response Time"
            value={`${kpis.avgResponse} min`}
            icon={Clock}
            tone="muted"
            footer="created → accepted (SLA metric)"
            tooltip="Avg Response Time: average time from WO creation until it is accepted by the engineer. Key SLA metric — the lower, the better the team's responsiveness."
          />
          <KpiCard
            label="Avg Active Repair"
            value={`${kpis.avgActiveRepair} min`}
            icon={Wrench}
            tone="muted"
            footer="MTTR — pauses excluded"
            tooltip="Avg Active Repair (MTTR): average effective repair time, from work start to completion, excluding pauses. Measures engineer technical efficiency."
          />
          <KpiCard
            label="Avg Line Downtime"
            value={`${kpis.avgLineDowntime} min`}
            icon={PowerOff}
            tone="muted"
            footer="business impact (line stopped → resumed)"
            tooltip="Avg Line Downtime: average time a production line was stopped (line stopped → line resumed). Measures real business impact in minutes lost."
          />
          <KpiCard
            label="Parts Used Today"
            value={partsToday ?? 0}
            icon={Package}
            tone="muted"
            footer="total parts consumed today"
            tooltip="Parts Used Today: total parts/products consumed in repairs during today. Useful for consumption and cost tracking."
          />
          <KpiCard
            label="Total Downtime (Selected Range)"
            value={formatMinutes(kpis.totalDowntimeMin)}
            icon={TrendingDown}
            tone={kpis.totalDowntimeMin > 0 ? "red" : "muted"}
            footer="sum of line downtime in period"
            tooltip="Total Downtime: sum of all line stoppage minutes for finalized WOs within the selected period."
          />
        </div>

        {/* Quick Actions */}
        <div className="flex gap-3 flex-wrap">
          <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={() => navigate("/dashboard/work-orders", { state: { openCreate: true } })}>
            <Plus className="h-4 w-4 mr-2" /> New Work Order
          </Button>
          <Button variant="outline" onClick={() => navigate("/dashboard/work-orders?status=open")}>
            <ExternalLink className="h-4 w-4 mr-2" /> View Open WOs
          </Button>
          <Button variant="outline" onClick={() => navigate("/dashboard/control-center")}>
            <Monitor className="h-4 w-4 mr-2" /> Control Center
          </Button>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Quick Navigation</h3>
          <ManagerNavCards openWOs={openCount} />
        </div>

        <Dialog open={showChangePin} onOpenChange={(o) => { setShowChangePin(o); if (!o) { setNewPin(""); setConfirmPin(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Change Admin PIN</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-pin">New PIN</Label>
                <Input id="new-pin" type="password" placeholder="Enter new PIN..." value={newPin} onChange={(e) => setNewPin(e.target.value)} maxLength={8} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-pin">Confirm PIN</Label>
                <Input id="confirm-pin" type="password" placeholder="Confirm new PIN..." value={confirmPin} onChange={(e) => setConfirmPin(e.target.value)} maxLength={8} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowChangePin(false)}>Cancel</Button>
              <Button onClick={handleChangePin} disabled={savingPin || newPin.length < 4}>
                {savingPin && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save PIN
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
