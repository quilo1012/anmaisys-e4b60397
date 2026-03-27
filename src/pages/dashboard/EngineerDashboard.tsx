import { useState, useMemo, useRef } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardList, Play, CheckCircle, Loader2, Package, Activity, Timer, AlertTriangle, PenTool, Phone, MapPin, Wrench, Camera, Printer, Focus, Users } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useWorkOrders, useReceiveWorkOrder, useArriveWorkOrder, useStartWorkOrder, useFinishWorkOrder } from "@/hooks/useWorkOrders";
import { useWOAlerts } from "@/hooks/useWOAlerts";
import { stopAlertSound } from "@/lib/shifts";
import { useTotalPartsUsedByEngineer, usePartsCountByWOs } from "@/hooks/useStock";
import { useWOPhotos, useUploadWOPhoto } from "@/hooks/useWOPhotos";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format, differenceInMinutes } from "date-fns";
import { PartsUsedDialog } from "@/components/PartsUsedDialog";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePredictiveAlerts } from "@/hooks/usePredictiveAlerts";
import { useOnlineEngineers } from "@/hooks/useOnlineEngineers";

const SLA_TARGETS: Record<string, number> = { low: 120, medium: 60, high: 30, critical: 10 };

const statusConfig: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-100 text-blue-800 border-blue-200" },
  received: { label: "Received", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  arrived: { label: "Arrived", className: "bg-purple-100 text-purple-800 border-purple-200" },
  in_progress: { label: "In Progress", className: "bg-amber-100 text-amber-800 border-amber-200" },
  finished: { label: "Finished", className: "bg-teal-100 text-teal-800 border-teal-200" },
  closed: { label: "Closed", className: "bg-green-100 text-green-800 border-green-200" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 border-green-200" },
  force_closed: { label: "Force Closed", className: "bg-gray-100 text-gray-800 border-gray-200" },
};

function SLACountdown({ wo }: { wo: any }) {
  const priority = wo.priority || "medium";
  const target = SLA_TARGETS[priority] || 60;
  const elapsed = differenceInMinutes(new Date(), new Date(wo.created_at));
  const remaining = target - elapsed;
  const breached = remaining <= 0;
  return (
    <span className={`text-xs font-mono font-bold ${breached ? "text-red-600" : remaining <= 10 ? "text-orange-600" : "text-green-600"}`}>
      {breached ? `⚠️ +${Math.abs(remaining)}min` : `${remaining}min`}
    </span>
  );
}

const PRE_SERVICE_CHECKLIST = [
  { id: "machine_off", label: "Machine switched off" },
  { id: "energy_lockout", label: "Energy lockout applied" },
  { id: "area_clear", label: "Work area clear and safe" },
  { id: "tools_ready", label: "Tools and PPE ready" },
];

const POST_SERVICE_CHECKLIST = [
  { id: "inspection_done", label: "Inspection completed" },
  { id: "final_test", label: "Final test passed" },
  { id: "machine_clean", label: "Machine cleaned" },
  { id: "operator_approved", label: "Operator/Line leader approved" },
];

export default function EngineerDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { data: workOrders, isLoading } = useWorkOrders({ statusIn: ["open", "received", "arrived", "in_progress"] as any });
  const { data: allCompleted } = useWorkOrders({ statusIn: ["completed", "closed", "finished"] as any });
  const receiveWO = useReceiveWorkOrder();
  const arriveWO = useArriveWorkOrder();
  const startWO = useStartWorkOrder();
  const finishWO = useFinishWorkOrder();
  const uploadPhoto = useUploadWOPhoto();
  const navigate = useNavigate();
  const { data: totalParts } = useTotalPartsUsedByEngineer(user?.id);
  useWOAlerts();
  const { alerts: predictiveAlerts } = usePredictiveAlerts();
  const { data: onlineEngineers } = useOnlineEngineers();
  const [focusMode, setFocusMode] = useState(false);

  const [partsDialogWO, setPartsDialogWO] = useState<string | null>(null);
  const [signDialogWO, setSignDialogWO] = useState<string | null>(null);
  const [signName, setSignName] = useState("");
  
  // Pre-service checklist state
  const [preChecklistWO, setPreChecklistWO] = useState<string | null>(null);
  const [preCheckedItems, setPreCheckedItems] = useState<Record<string, boolean>>({});
  
  // Post-service checklist state (FINISH flow)
  const [postChecklistWO, setPostChecklistWO] = useState<string | null>(null);
  const [postCheckedItems, setPostCheckedItems] = useState<Record<string, boolean>>({});

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const activeWOIds = useMemo(() => workOrders?.filter(
    (wo) => wo.status === "open" || (["received", "arrived", "in_progress"].includes(wo.status) && wo.engineer_id === user?.id)
  ).map((w) => w.id) ?? [], [workOrders, user]);
  const { data: partsCounts } = usePartsCountByWOs(activeWOIds);

  const [photosUploaded, setPhotosUploaded] = useState<Record<string, { before: boolean; after: boolean }>>({});

  const kpis = useMemo(() => {
    if (!allCompleted || !user) return { totalCompleted: 0, avgResponse: 0, avgMTTR: 0 };
    const myCompleted = allCompleted.filter((w) => w.engineer_id === user.id);
    const totalCompleted = myCompleted.length;
    let totalResponse = 0, responseCount = 0, totalMTTR = 0, mttrCount = 0;
    myCompleted.forEach((wo) => {
      if (wo.started_at) {
        totalResponse += differenceInMinutes(new Date(wo.started_at), new Date(wo.created_at));
        responseCount++;
        if (wo.finished_at || wo.completed_at) {
          totalMTTR += differenceInMinutes(new Date(wo.finished_at || wo.completed_at!), new Date(wo.started_at));
          mttrCount++;
        }
      }
    });
    return {
      totalCompleted,
      avgResponse: responseCount ? Math.round(totalResponse / responseCount) : 0,
      avgMTTR: mttrCount ? Math.round(totalMTTR / mttrCount) : 0,
    };
  }, [allCompleted, user]);

  const activeWOs = useMemo(() => {
    const all = workOrders?.filter(
      (wo) => wo.status === "open" || (["received", "arrived", "in_progress"].includes(wo.status) && wo.engineer_id === user?.id)
    ) || [];
    if (focusMode && all.length > 0) {
      // Focus mode: show only the oldest actionable WO
      return [all[all.length - 1]];
    }
    return all;
  }, [workOrders, user, focusMode]);

  // Workload balancing: suggest engineer with fewest active WOs
  const suggestedEngineer = useMemo(() => {
    if (!onlineEngineers || !workOrders) return null;
    const activeCountMap: Record<string, number> = {};
    onlineEngineers.forEach((e) => { activeCountMap[e.id] = 0; });
    workOrders.filter((w) => ["received", "arrived", "in_progress"].includes(w.status) && w.engineer_id).forEach((w) => {
      if (activeCountMap[w.engineer_id!] !== undefined) activeCountMap[w.engineer_id!]++;
    });
    let minId: string | null = null;
    let minCount = Infinity;
    Object.entries(activeCountMap).forEach(([id, count]) => {
      if (count < minCount) { minCount = count; minId = id; }
    });
    return minId ? onlineEngineers.find((e) => e.id === minId) || null : null;
  }, [onlineEngineers, workOrders]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>, woId: string, type: "before" | "after") => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadPhoto.mutateAsync({ workOrderId: woId, photoType: type, file });
      setPhotosUploaded((prev) => ({ ...prev, [woId]: { ...prev[woId], [type]: true } }));
      toast({ title: `${type === "before" ? "Before" : "After"} photo uploaded` });
    } catch (err: any) {
      toast({ title: "Upload error", description: err.message, variant: "destructive" });
    }
    e.target.value = "";
  };

  // ACCEPT → show pre-service checklist
  const handleAcceptClick = (woId: string) => {
    stopAlertSound();
    setPreCheckedItems({});
    setPreChecklistWO(woId);
  };

  const handlePreChecklistComplete = () => {
    if (!preChecklistWO) return;
    receiveWO.mutate(preChecklistWO);
    setPreChecklistWO(null);
  };

  // START → proceed immediately, show photo reminder toast
  const handleStartClick = (woId: string) => {
    startWO.mutate(woId);
    toast({ title: "📸 Photo reminder", description: "Don't forget to add a Before photo!" });
  };

  // FINISH → go straight to post-service checklist (no photo blocking)
  const handleFinishClick = (woId: string) => {
    toast({ title: "📸 Photo reminder", description: "Don't forget to add an After photo!" });
    setPostCheckedItems({});
    setPostChecklistWO(woId);
  };

  const handlePostChecklistComplete = () => {
    if (!postChecklistWO) return;
    setPostChecklistWO(null);
    setSignDialogWO(postChecklistWO);
  };

  const handleFinishConfirm = async () => {
    if (!signDialogWO || !signName.trim()) return;
    await finishWO.mutateAsync({ woId: signDialogWO, signedByName: signName.trim() });
    setSignDialogWO(null);
    setSignName("");
  };

  const allPreChecked = PRE_SERVICE_CHECKLIST.every((item) => preCheckedItems[item.id]);
  const allPostChecked = POST_SERVICE_CHECKLIST.every((item) => postCheckedItems[item.id]);

  const triggerFileInput = (woId: string, type: "before" | "after") => {
    fileInputRefs.current[`${woId}-${type}`]?.click();
  };

  // Mobile card view
  const MobileWOCard = ({ wo }: { wo: any }) => {
    const cfg = statusConfig[wo.status] || statusConfig.open;
    const woPhotos = photosUploaded[wo.id] || { before: false, after: false };
    const isOpen = wo.status === "open";
    return (
      <Card className={`${isOpen ? "border-destructive bg-destructive/5 animate-pulse" : ""}`}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold text-lg cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>
              WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}
            </span>
            <div className="flex gap-1.5 items-center">
              <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
              {!isOpen && (
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => window.open(`/dashboard/wo/${wo.id}`, "_blank")}>
                  <Printer className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-muted-foreground">Machine:</span><p className="font-medium">{wo.machine}</p></div>
            <div><span className="text-muted-foreground">SLA:</span><p><SLACountdown wo={wo} /></p></div>
            <div><span className="text-muted-foreground">Requester:</span><p className="font-medium">{wo.requester_name}</p></div>
            <div><span className="text-muted-foreground">Created:</span><p className="font-medium">{format(new Date(wo.created_at), "dd/MM HH:mm")}</p></div>
          </div>
          <p className="text-sm text-muted-foreground truncate">{wo.description}</p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            {wo.status === "open" && (
              <Button size="lg" className="col-span-2 h-14 text-base font-bold" onClick={() => handleAcceptClick(wo.id)} disabled={receiveWO.isPending}>
                <Phone className="h-5 w-5 mr-2" /> ACCEPT
              </Button>
            )}
            {wo.status === "received" && wo.engineer_id === user?.id && (
              <Button size="lg" className="col-span-2 h-14 text-base font-bold" onClick={() => arriveWO.mutate(wo.id)} disabled={arriveWO.isPending}>
                <MapPin className="h-5 w-5 mr-2" /> ARRIVED
              </Button>
            )}
            {wo.status === "arrived" && wo.engineer_id === user?.id && (
              <Button size="lg" className="col-span-2 h-14 text-base font-bold" onClick={() => handleStartClick(wo.id)} disabled={startWO.isPending}>
                <Play className="h-5 w-5 mr-2" /> START
              </Button>
            )}
            {wo.status === "in_progress" && wo.engineer_id === user?.id && (
              <>
                <Button size="lg" variant="outline" className="h-14 text-base" onClick={() => setPartsDialogWO(wo.id)}>
                  <Package className="h-5 w-5 mr-2" /> Parts
                </Button>
                <input type="file" accept="image/*" capture="environment" className="hidden" ref={(el) => { fileInputRefs.current[`${wo.id}-before`] = el; }} onChange={(e) => handlePhotoUpload(e, wo.id, "before")} />
                <Button size="lg" variant={woPhotos.before ? "default" : "outline"} className="h-14 text-base" onClick={() => triggerFileInput(wo.id, "before")} disabled={uploadPhoto.isPending}>
                  <Camera className="h-5 w-5 mr-2" /> {woPhotos.before ? "✓ Before" : "Before"}
                </Button>
                <input type="file" accept="image/*" capture="environment" className="hidden" ref={(el) => { fileInputRefs.current[`${wo.id}-after`] = el; }} onChange={(e) => handlePhotoUpload(e, wo.id, "after")} />
                <Button size="lg" variant={woPhotos.after ? "default" : "outline"} className="h-14 text-base" onClick={() => triggerFileInput(wo.id, "after")} disabled={uploadPhoto.isPending}>
                  <Camera className="h-5 w-5 mr-2" /> {woPhotos.after ? "✓ After" : "After"}
                </Button>
                <Button size="lg" variant="secondary" className="h-14 text-base font-bold" onClick={() => handleFinishClick(wo.id)}>
                  <PenTool className="h-5 w-5 mr-2" /> FINISH
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 md:space-y-6">
        {activeWOs && activeWOs.filter(wo => wo.status === "open").length > 0 && (
          <Alert variant="destructive" className="border-destructive bg-destructive/10 animate-pulse">
            <AlertTriangle className="h-5 w-5" />
            <AlertTitle className="text-lg font-bold">⚠️ {activeWOs.filter(wo => wo.status === "open").length} Open Work Order(s) Waiting!</AlertTitle>
            <AlertDescription>There are unassigned work orders that need attention.</AlertDescription>
          </Alert>
        )}

        {/* Predictive Alerts */}
        {predictiveAlerts.length > 0 && (
          <Alert className="border-purple-500 bg-purple-500/10 text-purple-800">
            <AlertTriangle className="h-5 w-5 text-purple-600" />
            <AlertTitle className="text-sm font-bold">🟣 {predictiveAlerts.length} Predictive Alert(s)</AlertTitle>
            <AlertDescription className="text-xs">
              {predictiveAlerts.slice(0, 2).map((a, i) => (
                <span key={i} className="block">{a.machine}: "{a.problem}" — {a.count}x in 30 days</span>
              ))}
            </AlertDescription>
          </Alert>
        )}

        {/* Suggested Engineer + Focus Mode */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl md:text-2xl font-bold">Engineer Panel</h2>
            <p className="text-muted-foreground text-sm">View and execute work orders</p>
          </div>
          <div className="flex items-center gap-2">
            {suggestedEngineer && (
              <Badge variant="outline" className="bg-blue-500/10 border-blue-500 text-blue-700 gap-1">
                <Users className="h-3 w-3" /> Suggested: {suggestedEngineer.name}
              </Badge>
            )}
            <Button variant={focusMode ? "default" : "outline"} size="sm" onClick={() => setFocusMode(!focusMode)} className="gap-1">
              <Focus className="h-4 w-4" /> {focusMode ? "Focus ON" : "Focus"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 md:p-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium">Completed</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0"><div className="text-xl md:text-2xl font-bold">{kpis.totalCompleted}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 md:p-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium">Avg Response</CardTitle>
              <Timer className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0"><div className="text-xl md:text-2xl font-bold">{kpis.avgResponse}m</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 md:p-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium">Avg MTTR</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0"><div className="text-xl md:text-2xl font-bold">{kpis.avgMTTR}m</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 p-3 md:p-6 md:pb-2">
              <CardTitle className="text-xs md:text-sm font-medium">Parts Used</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0"><div className="text-xl md:text-2xl font-bold">{totalParts ?? 0}</div></CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="flex items-center gap-2 text-lg"><ClipboardList className="h-5 w-5" /> Work Orders</CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !activeWOs?.length ? (
              <p className="text-muted-foreground text-center py-8">No open work orders right now.</p>
            ) : isMobile ? (
              <div className="space-y-3">
                {activeWOs.map((wo) => <MobileWOCard key={wo.id} wo={wo} />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2 font-medium">WO#</th>
                      <th className="text-left p-2 font-medium">SLA</th>
                      <th className="text-left p-2 font-medium">Requester</th>
                      <th className="text-left p-2 font-medium">Machine</th>
                      <th className="text-left p-2 font-medium">Description</th>
                      <th className="text-left p-2 font-medium">Status</th>
                      <th className="text-left p-2 font-medium">Created</th>
                      <th className="text-left p-2 font-medium">Parts</th>
                      <th className="text-left p-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeWOs.map((wo) => {
                      const cfg = statusConfig[wo.status] || statusConfig.open;
                      const woPhotos = photosUploaded[wo.id] || { before: false, after: false };
                      return (
                        <tr key={wo.id} className={`border-b ${wo.priority === "critical" ? "bg-red-50" : ""}`}>
                          <td className="p-2 font-mono font-medium cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}</td>
                          <td className="p-2"><SLACountdown wo={wo} /></td>
                          <td className="p-2">{wo.requester_name}</td>
                          <td className="p-2">{wo.machine}</td>
                          <td className="p-2 max-w-[200px] truncate">{wo.description}</td>
                          <td className="p-2"><Badge variant="outline" className={cfg.className}>{cfg.label}</Badge></td>
                          <td className="p-2 text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</td>
                          <td className="p-2">{partsCounts?.[wo.id] ? <Badge variant="secondary">{partsCounts[wo.id]}</Badge> : "—"}</td>
                          <td className="p-2">
                            <div className="flex gap-1 flex-wrap">
                              {wo.status === "open" && (
                                <Button size="sm" onClick={() => handleAcceptClick(wo.id)} disabled={receiveWO.isPending}>
                                  <Phone className="h-3 w-3 mr-1" /> Receive
                                </Button>
                              )}
                              {wo.status === "received" && wo.engineer_id === user?.id && (
                                <Button size="sm" onClick={() => arriveWO.mutate(wo.id)} disabled={arriveWO.isPending}>
                                  <MapPin className="h-3 w-3 mr-1" /> Arrived
                                </Button>
                              )}
                              {wo.status === "arrived" && wo.engineer_id === user?.id && (
                                <Button size="sm" onClick={() => handleStartClick(wo.id)} disabled={startWO.isPending}>
                                  <Play className="h-3 w-3 mr-1" /> Start
                                </Button>
                              )}
                              {wo.status === "in_progress" && wo.engineer_id === user?.id && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => setPartsDialogWO(wo.id)}>
                                    <Package className="h-3 w-3 mr-1" /> Parts
                                  </Button>
                                  <input type="file" accept="image/*" capture="environment" className="hidden" ref={(el) => { fileInputRefs.current[`${wo.id}-before`] = el; }} onChange={(e) => handlePhotoUpload(e, wo.id, "before")} />
                                  <Button size="sm" variant={woPhotos.before ? "default" : "outline"} onClick={() => triggerFileInput(wo.id, "before")} disabled={uploadPhoto.isPending}>
                                    <Camera className="h-3 w-3 mr-1" /> {woPhotos.before ? "✓" : "Before"}
                                  </Button>
                                  <input type="file" accept="image/*" capture="environment" className="hidden" ref={(el) => { fileInputRefs.current[`${wo.id}-after`] = el; }} onChange={(e) => handlePhotoUpload(e, wo.id, "after")} />
                                  <Button size="sm" variant={woPhotos.after ? "default" : "outline"} onClick={() => triggerFileInput(wo.id, "after")} disabled={uploadPhoto.isPending}>
                                    <Camera className="h-3 w-3 mr-1" /> {woPhotos.after ? "✓" : "After"}
                                  </Button>
                                  <Button size="sm" variant="secondary" onClick={() => handleFinishClick(wo.id)}>
                                    <PenTool className="h-3 w-3 mr-1" /> Finish
                                  </Button>
                                </>
                              )}
                              {/* Print WO detail */}
                              {wo.status !== "open" && (
                                <Button size="sm" variant="ghost" onClick={() => window.open(`/dashboard/wo/${wo.id}`, "_blank")}>
                                  <Printer className="h-3 w-3 mr-1" /> Print
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {partsDialogWO && (
        <PartsUsedDialog open={!!partsDialogWO} onOpenChange={(o) => !o && setPartsDialogWO(null)} workOrderId={partsDialogWO} />
      )}

      {/* PRE-SERVICE Safety Checklist (on Accept) */}
      <Dialog open={!!preChecklistWO} onOpenChange={(open) => { if (!open) setPreChecklistWO(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" /> Pre-Service Safety Checklist
            </DialogTitle>
            <DialogDescription>Verify safety conditions before starting work on the machine.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {PRE_SERVICE_CHECKLIST.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <Checkbox
                  id={`pre-${item.id}`}
                  checked={!!preCheckedItems[item.id]}
                  onCheckedChange={(checked) => setPreCheckedItems((prev) => ({ ...prev, [item.id]: !!checked }))}
                />
                <Label htmlFor={`pre-${item.id}`} className="cursor-pointer text-base">{item.label}</Label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreChecklistWO(null)}>Cancel</Button>
            <Button onClick={handlePreChecklistComplete} disabled={!allPreChecked || receiveWO.isPending}>
              {receiveWO.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Accept Work Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* POST-SERVICE Safety Checklist (on Finish) */}
      <Dialog open={!!postChecklistWO} onOpenChange={(open) => { if (!open) setPostChecklistWO(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" /> Post-Service Checklist
            </DialogTitle>
            <DialogDescription>Confirm all items are completed and approved before finishing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {POST_SERVICE_CHECKLIST.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <Checkbox
                  id={`post-${item.id}`}
                  checked={!!postCheckedItems[item.id]}
                  onCheckedChange={(checked) => setPostCheckedItems((prev) => ({ ...prev, [item.id]: !!checked }))}
                />
                <Label htmlFor={`post-${item.id}`} className="cursor-pointer text-base">{item.label}</Label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPostChecklistWO(null)}>Cancel</Button>
            <Button onClick={handlePostChecklistComplete} disabled={!allPostChecked}>
              Continue to Signature
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign Dialog */}
      <Dialog open={!!signDialogWO} onOpenChange={(open) => { if (!open) { setSignDialogWO(null); setSignName(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PenTool className="h-5 w-5" /> Confirm & Finish Work Order</DialogTitle>
            <DialogDescription>Sign and finish the work order</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Type your full name below to sign and finish this work order.</p>
            <div className="space-y-2">
              <Label htmlFor="sign-name">Full Name (Digital Signature)</Label>
              <Input id="sign-name" placeholder="e.g. John Smith" value={signName} onChange={(e) => setSignName(e.target.value)} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSignDialogWO(null); setSignName(""); }}>Cancel</Button>
            <Button onClick={handleFinishConfirm} disabled={!signName.trim() || finishWO.isPending}>
              {finishWO.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm & Finish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo Prompt Dialog */}
      <Dialog open={!!photoPromptWO} onOpenChange={(open) => { if (!open) { handlePhotoPromptSkip(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" /> {photoPromptType === "before" ? "Before" : "After"} Photo
            </DialogTitle>
            <DialogDescription>
              {photoPromptType === "before"
                ? "Take a photo of the machine before starting the repair."
                : "Take a photo of the machine after completing the repair."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <input type="file" accept="image/*" capture="environment" className="hidden" ref={photoPromptFileRef} onChange={handlePhotoPromptUpload} />
            <Button size="lg" className="h-16 w-full text-lg gap-2" onClick={() => photoPromptFileRef.current?.click()} disabled={uploadPhoto.isPending}>
              {uploadPhoto.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              Take / Upload Photo
            </Button>
            <Button variant="ghost" className="text-muted-foreground" onClick={handlePhotoPromptSkip}>
              Skip for now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}