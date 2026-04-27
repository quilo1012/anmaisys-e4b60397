import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, LayoutDashboard, Timer, Activity, Package, AlertTriangle, BarChart3, Cog, AlertCircle, Loader2, Lock, Plus, ExternalLink, Monitor, Clock, Wrench, PowerOff } from "lucide-react";
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

const DONE_STATUSES = ["completed", "closed", "finished", "force_closed"];

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
  const { data: woMetrics = [] } = useAllWoMetrics();
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

  // Three distinct labeled time KPIs from v_wo_metrics (single source of truth)
  const kpis = useMemo(() => {
    const respM = woMetrics.filter((m) => m.response_time_sec !== null);
    const avgResponse = respM.length
      ? Math.round(respM.reduce((s, m) => s + (m.response_time_sec || 0), 0) / respM.length / 60)
      : 0;

    const repairM = woMetrics.filter((m) => m.active_repair_sec !== null && m.active_repair_sec > 0);
    const avgActiveRepair = repairM.length
      ? Math.round(repairM.reduce((s, m) => s + (m.active_repair_sec || 0), 0) / repairM.length / 60)
      : 0;

    const downM = woMetrics.filter((m) => m.line_downtime_sec !== null && m.line_downtime_sec > 0);
    const avgLineDowntime = downM.length
      ? Math.round(downM.reduce((s, m) => s + (m.line_downtime_sec || 0), 0) / downM.length / 60)
      : 0;

    return { avgResponse, avgActiveRepair, avgLineDowntime };
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

        {/* Unified KPI grid: 8 cards in 2 rows of 4 (single source of truth: v_wo_metrics) */}
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 auto-rows-fr">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium">Open WOs</CardTitle>
                <KpiInfoTooltip text="Open Work Orders: ordens criadas que ainda não foram aceites por um engenheiro. Indica o backlog atual a aguardar resposta." />
              </div>
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{openCount}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium">In Progress</CardTitle>
                <KpiInfoTooltip text="In Progress: ordens já aceites por um engenheiro e em execução (recebidas, em deslocação ou em reparação)." />
              </div>
              <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{inProgressCount}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium">Finished Today</CardTitle>
                <KpiInfoTooltip text="Finished Today: número de ordens concluídas (finished/closed/completed) no dia de hoje. Indicador de produtividade diária." />
              </div>
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{completedToday}</div></CardContent>
          </Card>
          <Card className={lowStockCount > 0 ? "border-destructive" : ""}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium">Low Stock</CardTitle>
                <KpiInfoTooltip text="Low Stock: número de produtos cuja quantidade em armazém está igual ou abaixo do stock mínimo definido. Requer reposição." />
              </div>
              <AlertTriangle className={`h-4 w-4 ${lowStockCount > 0 ? "text-destructive" : "text-muted-foreground"}`} />
            </CardHeader>
            <CardContent><div className={`text-2xl font-bold ${lowStockCount > 0 ? "text-destructive" : ""}`}>{lowStockCount}</div></CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
                <KpiInfoTooltip text="Avg Response Time: tempo médio desde a criação da WO até ser aceite pelo engenheiro. Métrica-chave de SLA — quanto menor, melhor a capacidade de resposta da equipa." />
              </div>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.avgResponse} min</div>
              <p className="text-xs text-muted-foreground mt-1">created → accepted (SLA metric)</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium">Avg Active Repair</CardTitle>
                <KpiInfoTooltip text="Avg Active Repair (MTTR): tempo médio efetivo de reparação, do início do trabalho até à conclusão, excluindo pausas. Mede a eficiência técnica do engenheiro." />
              </div>
              <Wrench className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.avgActiveRepair} min</div>
              <p className="text-xs text-muted-foreground mt-1">MTTR — pauses excluded</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium">Avg Line Downtime</CardTitle>
                <KpiInfoTooltip text="Avg Line Downtime: tempo médio em que a linha de produção esteve parada (linha parada → linha retomada). Mede o impacto real no negócio em minutos perdidos." />
              </div>
              <PowerOff className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.avgLineDowntime} min</div>
              <p className="text-xs text-muted-foreground mt-1">business impact (line stopped → resumed)</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="flex items-center gap-1.5">
                <CardTitle className="text-sm font-medium">Parts Used Today</CardTitle>
                <KpiInfoTooltip text="Parts Used Today: total de peças/produtos consumidos em reparações durante o dia de hoje. Útil para acompanhamento de consumo e custos." />
              </div>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{partsToday ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">total parts consumed today</p>
            </CardContent>
          </Card>
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
