import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardList, Play, CheckCircle, Loader2, Package, Activity, Timer, AlertTriangle, PenTool, Camera, Printer, Focus, Users, Pause, PlayCircle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useWorkOrders, useAcceptAndStartWorkOrder, useStartWorkOrder, useFinishWorkOrder, usePauseWorkOrder, useResumeWorkOrder } from "@/hooks/useWorkOrders";
import { useWOAlerts } from "@/hooks/useWOAlerts";
import { stopAlertSound } from "@/lib/shifts";
import { useTotalPartsUsedByEngineer, usePartsCountByWOs } from "@/hooks/useStock";
import { useUploadWOPhoto, useWOPhotos } from "@/hooks/useWOPhotos";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { format, differenceInMinutes } from "date-fns";
import { PartsUsedDialog } from "@/components/PartsUsedDialog";
import { PinDialog, type EngineerIdentity } from "@/components/PinDialog";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePredictiveAlerts } from "@/hooks/usePredictiveAlerts";
import { useOnlineEngineers } from "@/hooks/useOnlineEngineers";
import { useChecklistsByProblemName, useChecklistResponses, useSaveChecklistResponse } from "@/hooks/useChecklists";

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

// Inline checklist component for in_progress WOs
function InlineChecklist({ wo, currentEngineer }: { wo: any; currentEngineer: EngineerIdentity | null }) {
  const { data: checklistItems } = useChecklistsByProblemName(wo.description);
  const { data: responses } = useChecklistResponses(wo.id);
  const saveResponse = useSaveChecklistResponse();

  if (!checklistItems || checklistItems.length === 0) return null;

  const responseMap = new Map(responses?.map(r => [r.checklist_id, r]) || []);

  const grouped: Record<string, typeof checklistItems> = {};
  checklistItems.forEach(item => {
    if (!grouped[item.type]) grouped[item.type] = [];
    grouped[item.type].push(item);
  });

  const handleToggle = (checklistId: string, checked: boolean) => {
    saveResponse.mutate({
      workOrderId: wo.id,
      checklistId,
      completed: checked,
      completedBy: currentEngineer?.id,
    });
  };

  const completedCount = checklistItems.filter(i => responseMap.get(i.id)?.completed).length;
  const requiredIncomplete = checklistItems.filter(i => i.is_required && !responseMap.get(i.id)?.completed);

  return (
    <div className="border rounded-lg p-3 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-1.5">
          <ClipboardList className="h-4 w-4" /> Checklist
        </h4>
        <Badge variant={requiredIncomplete.length > 0 ? "destructive" : "default"} className="text-xs">
          {completedCount}/{checklistItems.length} ✓
        </Badge>
      </div>
      {Object.entries(grouped).map(([type, items]) => (
        <div key={type} className="space-y-1.5">
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{type}</p>
          {items.map((item) => {
            const resp = responseMap.get(item.id);
            const isChecked = resp?.completed ?? false;
            return (
              <div key={item.id} className="flex items-center gap-3 min-h-[40px]">
                <Checkbox
                  id={`inline-cl-${item.id}`}
                  checked={isChecked}
                  onCheckedChange={(checked) => handleToggle(item.id, !!checked)}
                />
                <Label htmlFor={`inline-cl-${item.id}`} className="cursor-pointer text-sm flex-1">
                  {item.description}
                  {item.is_required && <span className="text-destructive ml-1">*</span>}
                </Label>
              </div>
            );
          })}
        </div>
      ))}
      {requiredIncomplete.length > 0 && (
        <p className="text-xs text-destructive font-medium flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {requiredIncomplete.length} required item(s) incomplete — Finish blocked
        </p>
      )}
    </div>
  );
}

// Hook to check if all required checklist items are complete for a WO
function useChecklistComplete(woDescription: string | undefined, woId: string | undefined) {
  const { data: checklistItems } = useChecklistsByProblemName(woDescription);
  const { data: responses } = useChecklistResponses(woId);

  return useMemo(() => {
    if (!checklistItems || checklistItems.length === 0) return true; // no checklist = no block
    const responseMap = new Map(responses?.map(r => [r.checklist_id, r]) || []);
    return checklistItems.filter(i => i.is_required).every(i => responseMap.get(i.id)?.completed);
  }, [checklistItems, responses]);
}

// DB-backed photo status button — replaces volatile local state
function PhotoStatusButton({ woId, photoType, onClick, disabled, size = "lg" }: { woId: string; photoType: "before" | "after"; onClick: () => void; disabled: boolean; size?: "sm" | "lg" }) {
  const { data: photos } = useWOPhotos(woId);
  const hasPhoto = photos?.some(p => p.photo_type === photoType) ?? false;
  const label = photoType === "before" ? "Before" : "After";
  return (
    <Button size={size} variant={hasPhoto ? "default" : "outline"} className={size === "lg" ? "h-14 text-base" : ""} onClick={onClick} disabled={disabled}>
      <Camera className={`${size === "lg" ? "h-5 w-5" : "h-3 w-3"} mr-${size === "lg" ? "2" : "1"}`} /> {hasPhoto ? `✓ ${size === "sm" ? "" : label}` : label}
    </Button>
  );
}

export default function EngineerDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { data: workOrders, isLoading } = useWorkOrders({ statusIn: ["open", "received", "arrived", "in_progress"] as any });
  const { data: allCompleted } = useWorkOrders({ statusIn: ["completed", "closed", "finished"] as any });
  const acceptAndStartWO = useAcceptAndStartWorkOrder();
  const startWO = useStartWorkOrder();
  const finishWO = useFinishWorkOrder();
  const pauseWO = usePauseWorkOrder();
  const resumeWO = useResumeWorkOrder();
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
  
  // PIN dialog state
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pendingPinAction, setPendingPinAction] = useState<((engineer: EngineerIdentity) => void) | null>(null);
  const [pinDialogTitle, setPinDialogTitle] = useState("Enter PIN");

  const [currentEngineer, setCurrentEngineer] = useState<EngineerIdentity | null>(() => {
    try {
      const saved = sessionStorage.getItem("currentEngineer");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const activeWOIds = useMemo(() => workOrders?.filter(
    (wo) => wo.status === "open" || ["received", "arrived", "in_progress"].includes(wo.status)
  ).map((w) => w.id) ?? [], [workOrders]);
  const { data: partsCounts } = usePartsCountByWOs(activeWOIds);

  // Persist currentEngineer to sessionStorage & restore from in_progress WO data
  useEffect(() => {
    if (currentEngineer) {
      sessionStorage.setItem("currentEngineer", JSON.stringify(currentEngineer));
    }
  }, [currentEngineer]);

  useEffect(() => {
    if (!currentEngineer && workOrders) {
      const inProgressWO = workOrders.find(wo => wo.status === "in_progress" && wo.engineer_id && wo.engineer_name);
      if (inProgressWO) {
        const restored = { id: inProgressWO.engineer_id!, name: inProgressWO.engineer_name! };
        setCurrentEngineer(restored);
        sessionStorage.setItem("currentEngineer", JSON.stringify(restored));
      }
    }
  }, [workOrders, currentEngineer]);

  const kpis = useMemo(() => {
    if (!allCompleted) return { totalCompleted: 0, avgResponse: 0, avgMTTR: 0 };
    const totalCompleted = allCompleted.length;
    let totalResponse = 0, responseCount = 0, totalMTTR = 0, mttrCount = 0;
    allCompleted.forEach((wo) => {
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
  }, [allCompleted]);

  const activeWOs = useMemo(() => {
    const all = workOrders?.filter(
      (wo) => wo.status === "open" || ["received", "arrived", "in_progress"].includes(wo.status)
    ) || [];
    if (focusMode && all.length > 0) {
      return [all[all.length - 1]];
    }
    return all;
  }, [workOrders, focusMode]);

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
      toast({ title: `${type === "before" ? "Before" : "After"} photo uploaded` });
    } catch (err: any) {
      toast({ title: "Upload error", description: err.message, variant: "destructive" });
    }
    e.target.value = "";
  };

  const requirePin = useCallback((title: string, action: (engineer: EngineerIdentity) => void) => {
    setPinDialogTitle(title);
    setPendingPinAction(() => action);
    setPinDialogOpen(true);
  }, []);

  // ACCEPT + START → PIN → immediately in_progress (no checklist dialog)
  const handleAcceptAndStartClick = (woId: string) => {
    stopAlertSound();
    requirePin("Confirm Accept + Start", async (engineer) => {
      setCurrentEngineer(engineer);
      try {
        await acceptAndStartWO.mutateAsync({ woId, engineerId: engineer.id, engineerName: engineer.name });
        toast({ title: "✅ Work Order started!", description: "Don't forget to add a Before photo!" });
      } catch (err: any) {
        toast({ title: "Error starting WO", description: err.message, variant: "destructive" });
      }
    });
  };

  // For WOs in received/arrived — just start
  const handleStartClick = (woId: string) => {
    requirePin("Confirm START", async (engineer) => {
      setCurrentEngineer(engineer);
      try {
        await startWO.mutateAsync({ woId, engineerId: engineer.id, engineerName: engineer.name });
        toast({ title: "✅ Work Order started!", description: "Don't forget to add a Before photo!" });
      } catch (err: any) {
        toast({ title: "Error starting WO", description: err.message, variant: "destructive" });
      }
    });
  };

  // FINISH → PIN → signature dialog (no post-checklist dialog)
  const handleFinishClick = (woId: string) => {
    requirePin("Confirm FINISH", (engineer) => {
      setCurrentEngineer(engineer);
      toast({ title: "📸 Photo reminder", description: "Don't forget to add an After photo!" });
      setSignDialogWO(woId);
    });
  };

  const handleFinishConfirm = async () => {
    if (!signDialogWO || !signName.trim() || !currentEngineer) return;
    await finishWO.mutateAsync({ woId: signDialogWO, signedByName: signName.trim(), engineerId: currentEngineer.id, engineerName: currentEngineer.name });
    setSignDialogWO(null);
    setSignName("");
    setCurrentEngineer(null);
  };

  const triggerFileInput = (woId: string, type: "before" | "after") => {
    fileInputRefs.current[`${woId}-${type}`]?.click();
  };

  // Mobile card with inline checklist
  const MobileWOCard = ({ wo }: { wo: any }) => {
    const cfg = statusConfig[wo.status] || statusConfig.open;
    const isOpen = wo.status === "open";
    const checklistComplete = useChecklistComplete(wo.description, wo.id);
    const isInProgress = wo.status === "in_progress";

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
            {wo.engineer_name && (
              <div className="col-span-2"><span className="text-muted-foreground">Engineer:</span><p className="font-medium">{wo.engineer_name}</p></div>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate">{wo.description}</p>

          {/* Inline checklist for in_progress WOs */}
          {isInProgress && <InlineChecklist wo={wo} currentEngineer={currentEngineer} />}

          <div className="grid grid-cols-2 gap-2 pt-1">
            {wo.status === "open" && (
              <Button size="lg" className="col-span-2 h-14 text-base font-bold bg-green-600 hover:bg-green-700 text-white" onClick={() => handleAcceptAndStartClick(wo.id)} disabled={acceptAndStartWO.isPending}>
                <Play className="h-5 w-5 mr-2" /> Accept + Start WO
              </Button>
            )}
            {(wo.status === "received" || wo.status === "arrived") && (
              <Button size="lg" className="col-span-2 h-14 text-base font-bold bg-green-600 hover:bg-green-700 text-white" onClick={() => handleStartClick(wo.id)} disabled={startWO.isPending}>
                <Play className="h-5 w-5 mr-2" /> START
              </Button>
            )}
            {isInProgress && (
              <>
                {(wo as any).paused_at ? (
                  <Button size="lg" variant="outline" className="h-14 text-base border-green-500 text-green-700" onClick={() => resumeWO.mutate(wo.id)} disabled={resumeWO.isPending}>
                    <PlayCircle className="h-5 w-5 mr-2" /> RESUME
                  </Button>
                ) : (
                  <Button size="lg" variant="outline" className="h-14 text-base border-yellow-500 text-yellow-700" onClick={() => pauseWO.mutate(wo.id)} disabled={pauseWO.isPending}>
                    <Pause className="h-5 w-5 mr-2" /> PAUSE
                  </Button>
                )}
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
                <Button
                  size="lg"
                  variant="secondary"
                  className="col-span-2 h-14 text-base font-bold"
                  onClick={() => handleFinishClick(wo.id)}
                  disabled={!!(wo as any).paused_at || !checklistComplete}
                >
                  <PenTool className="h-5 w-5 mr-2" /> Finish
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  // Desktop row finish button wrapper (needs hook at component level)
  const DesktopFinishButton = ({ wo }: { wo: any }) => {
    const checklistComplete = useChecklistComplete(wo.description, wo.id);
    return (
      <Button size="sm" variant="secondary" onClick={() => handleFinishClick(wo.id)} disabled={!!(wo as any).paused_at || !checklistComplete}>
        <PenTool className="h-3 w-3 mr-1" /> Finish
      </Button>
    );
  };

  // Desktop inline checklist row
  const DesktopInlineChecklist = ({ wo }: { wo: any }) => {
    if (wo.status !== "in_progress") return null;
    return (
      <tr>
        <td colSpan={10} className="p-2 pt-0">
          <InlineChecklist wo={wo} currentEngineer={currentEngineer} />
        </td>
      </tr>
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
                      <th className="text-left p-2 font-medium">Engineer</th>
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
                        <>
                          <tr key={wo.id} className={`border-b ${wo.priority === "critical" ? "bg-red-50" : ""}`}>
                            <td className="p-2 font-mono font-medium cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>WO-{new Date(wo.created_at).getFullYear()}-{String(wo.wo_number).padStart(6, "0")}</td>
                            <td className="p-2"><SLACountdown wo={wo} /></td>
                            <td className="p-2">{wo.requester_name}</td>
                            <td className="p-2">{wo.machine}</td>
                            <td className="p-2 max-w-[200px] truncate">{wo.description}</td>
                            <td className="p-2 text-muted-foreground">{wo.engineer_name || "—"}</td>
                            <td className="p-2"><Badge variant="outline" className={cfg.className}>{cfg.label}</Badge></td>
                            <td className="p-2 text-muted-foreground">{format(new Date(wo.created_at), "dd/MM HH:mm")}</td>
                            <td className="p-2">{partsCounts?.[wo.id] ? <Badge variant="secondary">{partsCounts[wo.id]}</Badge> : "—"}</td>
                            <td className="p-2">
                              <div className="flex gap-1 flex-wrap">
                                {wo.status === "open" && (
                                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleAcceptAndStartClick(wo.id)} disabled={acceptAndStartWO.isPending}>
                                    <Play className="h-3 w-3 mr-1" /> Accept + Start WO
                                  </Button>
                                )}
                                {(wo.status === "received" || wo.status === "arrived") && (
                                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => handleStartClick(wo.id)} disabled={startWO.isPending}>
                                    <Play className="h-3 w-3 mr-1" /> Start
                                  </Button>
                                )}
                                {wo.status === "in_progress" && (
                                  <>
                                    {(wo as any).paused_at ? (
                                      <Button size="sm" variant="outline" className="border-green-500 text-green-700" onClick={() => resumeWO.mutate(wo.id)} disabled={resumeWO.isPending}>
                                        <PlayCircle className="h-3 w-3 mr-1" /> Resume
                                      </Button>
                                    ) : (
                                      <Button size="sm" variant="outline" className="border-yellow-500 text-yellow-700" onClick={() => pauseWO.mutate(wo.id)} disabled={pauseWO.isPending}>
                                        <Pause className="h-3 w-3 mr-1" /> Pause
                                      </Button>
                                    )}
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
                                    <DesktopFinishButton wo={wo} />
                                  </>
                                )}
                                {wo.status !== "open" && (
                                  <Button size="sm" variant="ghost" onClick={() => window.open(`/dashboard/wo/${wo.id}`, "_blank")}>
                                    <Printer className="h-3 w-3 mr-1" /> Print
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                          <DesktopInlineChecklist key={`cl-${wo.id}`} wo={wo} />
                        </>
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

      {/* Sign Dialog */}
      <Dialog open={!!signDialogWO} onOpenChange={(open) => { if (!open) { setSignDialogWO(null); setSignName(""); setCurrentEngineer(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PenTool className="h-5 w-5" /> Confirm & Finish Work Order</DialogTitle>
            <DialogDescription>Sign and finish the work order</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {currentEngineer && (
              <p className="text-sm text-muted-foreground">Finishing as: <strong className="text-primary">{currentEngineer.name}</strong></p>
            )}
            <p className="text-sm text-muted-foreground">Type the operator/line leader's name below to sign and finish this work order.</p>
            <div className="space-y-2">
              <Label htmlFor="sign-name">Full Name (Digital Signature)</Label>
              <Input id="sign-name" placeholder="e.g. John Smith" value={signName} onChange={(e) => setSignName(e.target.value)} autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSignDialogWO(null); setSignName(""); setCurrentEngineer(null); }}>Cancel</Button>
            <Button onClick={handleFinishConfirm} disabled={!signName.trim() || finishWO.isPending}>
              {finishWO.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm & Finish
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PIN Verification Dialog */}
      <PinDialog
        open={pinDialogOpen}
        onOpenChange={(open) => {
          setPinDialogOpen(open);
          if (!open) setPendingPinAction(null);
        }}
        onSuccess={async (engineer) => {
          if (pendingPinAction) await pendingPinAction(engineer);
          setPendingPinAction(null);
        }}
        title={pinDialogTitle}
        description="Enter your engineer PIN to confirm this action."
      />
    </DashboardLayout>
  );
}
