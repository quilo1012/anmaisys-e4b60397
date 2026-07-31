import { useMemo, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, LayoutDashboard, Timer, Activity, Package, AlertTriangle, BarChart3, Cog, AlertCircle, Loader2, Lock, Plus, ExternalLink, Monitor, Clock, Wrench, PowerOff, TrendingDown } from "lucide-react";
import { formatMinutes } from "@/lib/formatDuration";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useTotalPartsUsedToday, useProducts } from "@/hooks/useStock";
import { useAllWoMetrics } from "@/hooks/useWoMetrics";
import { useDowntime } from "@/hooks/useDowntime";
import { reconcileMinutes } from "@/lib/downtimeReconcile";
import { isNoPlannedShift } from "@/lib/downtimeBuckets";
import { differenceInMinutes, startOfDay } from "date-fns";
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
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FactoryStatusStrip } from "@/components/FactoryStatusStrip";
import { ControlCentreHome } from "@/components/ControlCentreHome";
import { DashboardWelcome } from "@/components/DashboardWelcome";
import { RoleShortcutGrid } from "@/components/RoleShortcutGrid";
import { KpiCard } from "@/components/reports/KpiCard";
import { isWoOpen, countOpenWOs } from "@/lib/woStatus";
import { DateRangeFilter, DateRangePreset, DateRange, getPresetRange } from "@/components/DateRangeFilter";

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
  const ALLOWED = ["admin", "manager", "maintenance_manager", "supervisor", "planner", "viewer"];
  if (!ALLOWED.includes(role)) {
    return null;
  }

  return <ManagerDashboardContent />;
}

function ManagerDashboardContent() {
  const { data: allWOs } = useWorkOrders();
  const { data: partsToday } = useTotalPartsUsedToday();
  const { data: products } = useProducts();
  const [kpiPreset, setKpiPreset] = useState<DateRangePreset>("today");
  const [kpiRange, setKpiRange] = useState<DateRange>(() => getPresetRange("today"));
  const { data: woMetrics = [] } = useAllWoMetrics({ from: kpiRange.from, to: kpiRange.to });
  const { data: downtimeRecords } = useDowntime();
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

    // Avg Line Downtime: include finalized WOs AND any open WOs that have
    // line_stopped_at set (ongoing stoppages) so live impact shows in the KPI.
    const nowMs = Date.now();
    const downSamples: number[] = [];
    for (const m of finalized) {
      if (m.line_downtime_sec !== null && (m.line_downtime_sec ?? 0) > 0) {
        downSamples.push(m.line_downtime_sec as number);
      }
    }
    for (const m of woMetrics) {
      if (FINAL.has((m as any).status)) continue;
      if (!m.line_stopped_at) continue;
      const start = new Date(m.line_stopped_at).getTime();
      const end = m.line_resumed_at ? new Date(m.line_resumed_at).getTime() : nowMs;
      const sec = Math.max(0, Math.round((end - start) / 1000));
      if (sec > 0) downSamples.push(sec);
    }
    const avgLineDowntime = downSamples.length
      ? Math.round(downSamples.reduce((s, n) => s + n, 0) / downSamples.length / 60)
      : 0;

    return { avgResponse, avgActiveRepair, avgLineDowntime };
  }, [woMetrics]);

  // Total downtime aligned with the Downtime page (#10): includes both manual
  // downtime rows and Maintenance Order line-stopped windows; parallel stoppages
  // counted once via reconcileMinutes.
  const totalDowntimeMin = useMemo(() => {
    const recs = (downtimeRecords || []).filter(
      (r: any) => !isNoPlannedShift(r.reason, r.category),
    );
    // The exact instants the period filter chose. Widening them to whole days here
    // meant "Current shift" reported from midnight, so the night shift's small hours
    // counted as the day shift's downtime — the same bug the Downtime page had.
    const rangeStartMs = (kpiRange.from ?? startOfDay(new Date())).getTime();
    const rangeEndMs = Math.min((kpiRange.to ?? new Date()).getTime(), Date.now());
    const spans: { start: string; end: string | null }[] = recs.map((r) => ({
      start: r.started_at,
      end: r.ended_at,
    }));
    // Merge in WO-derived line stoppages so both views use the same source.
    for (const m of woMetrics as any[]) {
      if (!m?.line_stopped_at) continue;
      // Skip if a manual downtime already references this WO id (dedup).
      const woId = (m as any).id || (m as any).work_order_id;
      if (woId && recs.some((r: any) => r.work_order_id === woId)) continue;
      spans.push({ start: m.line_stopped_at, end: m.line_resumed_at ?? null });
    }
    return reconcileMinutes(spans, rangeStartMs, rangeEndMs, Date.now());
  }, [downtimeRecords, woMetrics, kpiRange]);

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
    { title: "Maintenance Orders", desc: "Table & Kanban", icon: ClipboardList, url: "/dashboard/work-orders" },
    { title: "Machines", desc: "Manage machines", icon: Cog, url: "/dashboard/machines" },
    { title: "Problems", desc: "Problem descriptions", icon: AlertCircle, url: "/dashboard/problems" },
    { title: "Stock", desc: "Parts & inventory", icon: Package, url: "/dashboard/stock" },
    ...(role === "admin" ? [{ title: "Audit Logs", desc: "Activity history", icon: Activity, url: "/dashboard/audit-logs" }] : []),
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <DashboardWelcome />

        {/* The four things that need a person right now — same strip, same numbers,
            wherever you land. */}
        <SectionErrorBoundary title="Live status">
          <FactoryStatusStrip />
        </SectionErrorBoundary>

        {/* The factory in one screen, in the space the banner used to hold. */}
        <SectionErrorBoundary title="Control centre">
          <ControlCentreHome />
        </SectionErrorBoundary>

        <PageHeader
          title={dashTitle}
          description="Where maintenance stands right now, and how the team performed over the period you choose."
          icon={<LayoutDashboard className="h-5 w-5" />}
          actions={
            <>
              <Button size="sm" onClick={() => navigate("/dashboard/work-orders", { state: { openCreate: true } })}>
                <Plus className="h-4 w-4 mr-2" /> New Order
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/work-orders?status=open")}>
                <ExternalLink className="h-4 w-4 mr-2" /> Open WOs
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/control-center")}>
                <Monitor className="h-4 w-4 mr-2" /> Control Center
              </Button>
              {role === "admin" && (
                <Button variant="outline" size="sm" onClick={() => setShowChangePin(true)}>
                  <Lock className="h-4 w-4 mr-2" /> Change PIN
                </Button>
              )}
            </>
          }
        />

        {/* Split by what the numbers actually measure.
            One grid of nine cards under a single "KPI period filter" read as though
            the filter governed all of them. It never did: the backlog, the low-stock
            count and today's totals ignore it entirely — so the screen could show
            "Yesterday" selected above "Completed Today 158". Each section now says
            which period it covers, and the filter sits on the only one it changes. */}
        <section aria-label="Right now" className="space-y-3">
          <SectionHeading>Right now</SectionHeading>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 auto-rows-fr">
            <KpiCard
              label="Open WOs"
              value={openCount}
              icon={<ClipboardList className="h-4 w-4" />}
              accent="blue"
              tooltip="Open Maintenance Orders: orders created that have not yet been accepted by an engineer. Shows the current backlog awaiting response."
            />
            <KpiCard
              label="In Progress"
              value={inProgressCount}
              icon={<LayoutDashboard className="h-4 w-4" />}
              accent="amber"
              tooltip="In Progress: orders already accepted by an engineer and being worked on (received, traveling, or under repair)."
            />
            <KpiCard
              label="Low Stock"
              value={lowStockCount}
              icon={<AlertTriangle className="h-4 w-4" />}
              accent={lowStockCount > 0 ? "red" : "muted"}
              tooltip="Low Stock: number of products whose on-hand quantity is at or below the defined minimum. Restocking required."
              highlight={lowStockCount > 0}
            />
          </div>
        </section>

        <section aria-label="Today" className="space-y-3">
          <SectionHeading>Today</SectionHeading>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 auto-rows-fr">
            <KpiCard
              label="Completed Today"
              value={completedToday}
              icon={<ClipboardList className="h-4 w-4" />}
              accent="green"
              tooltip="Completed Today: number of orders completed (finished/closed/completed) today. Daily productivity indicator."
            />
            <KpiCard
              label="Parts Used Today"
              value={partsToday ?? 0}
              icon={<Package className="h-4 w-4" />}
              accent="muted"
              sublabel="total parts consumed today"
              tooltip="Parts Used Today: total parts/products consumed in repairs during today. Useful for consumption and cost tracking."
            />
          </div>
        </section>

        <section aria-label="Selected period" className="space-y-3">
          <SectionHeading
            aside={
              <DateRangeFilter
                value={kpiRange}
                preset={kpiPreset}
                onChange={(r, p) => { setKpiRange(r); setKpiPreset(p); }}
                storageKey="manager-dashboard"
              />
            }
          >
            Response &amp; repair
          </SectionHeading>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-4 auto-rows-fr">
          <KpiCard
            label="Avg Response Time"
            value={`${kpis.avgResponse} min`}
            icon={<Clock className="h-4 w-4" />}
            accent="muted"
            sublabel="created → accepted (SLA metric)"
            tooltip="Avg Response Time: average time from WO creation until it is accepted by the engineer. Key SLA metric — the lower, the better the team's responsiveness."
          />
          <KpiCard
            label="Avg Active Repair"
            value={`${kpis.avgActiveRepair} min`}
            icon={<Wrench className="h-4 w-4" />}
            accent="muted"
            sublabel="MTTR — pauses excluded"
            tooltip="Avg Active Repair (MTTR): average effective repair time, from work start to completion, excluding pauses. Measures engineer technical efficiency."
          />
          <KpiCard
            label="Avg Line Downtime"
            value={`${kpis.avgLineDowntime} min`}
            icon={<PowerOff className="h-4 w-4" />}
            accent="muted"
            sublabel="business impact (line stopped → resumed)"
            tooltip="Avg Line Downtime: average time a production line was stopped (line stopped → line resumed). Measures real business impact in minutes lost."
          />
          <KpiCard
            label="Total Downtime"
            value={formatMinutes(totalDowntimeMin)}
            icon={<TrendingDown className="h-4 w-4" />}
            accent={totalDowntimeMin > 0 ? "red" : "muted"}
            sublabel="parallel stoppages counted once"
            tooltip="Total Downtime: wall-clock minutes any line was stopped within the selected period. Matches the Downtime page (parallel stoppages counted once)."
          />
          </div>
        </section>

        {/* Every screen this role can open, grouped as the sidebar groups them. */}
        <SectionErrorBoundary title="Shortcuts">
          <RoleShortcutGrid />
        </SectionErrorBoundary>

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
