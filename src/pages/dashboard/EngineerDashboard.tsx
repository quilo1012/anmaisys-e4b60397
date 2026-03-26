import { useState, useMemo, useRef } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardList, Play, CheckCircle, Loader2, Package, Activity, Timer, AlertTriangle, PenTool, Phone, MapPin, Wrench, Camera } from "lucide-react";
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

const CHECKLIST_ITEMS = [
  { id: "machine_off", label: "Machine switched off" },
  { id: "energy_lockout", label: "Energy lockout applied" },
  { id: "inspection_done", label: "Inspection completed" },
  { id: "final_test", label: "Final test passed" },
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

  const [partsDialogWO, setPartsDialogWO] = useState<string | null>(null);
  const [signDialogWO, setSignDialogWO] = useState<string | null>(null);
  const [signName, setSignName] = useState("");
  const [checklistWO, setChecklistWO] = useState<string | null>(null);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
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
          const endTime = wo.finished_at || wo.completed_at!;
          totalMTTR += differenceInMinutes(new Date(endTime), new Date(wo.started_at));
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

  const activeWOs = workOrders?.filter(
    (wo) => wo.status === "open" || (["received", "arrived", "in_progress"].includes(wo.status) && wo.engineer_id === user?.id)
  );

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>, woId: string, type: "before" | "after") => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadPhoto.mutateAsync({ workOrderId: woId, photoType: type, file });
      setPhotosUploaded((prev) => ({
        ...prev,
        [woId]: { ...prev[woId], [type]: true },
      }));
      toast({ title: `${type === "before" ? "Before" : "After"} photo uploaded` });
    } catch (err: any) {
      toast({ title: "Upload error", description: err.message, variant: "destructive" });
    }
    e.target.value = "";
  };

  const handleFinishClick = (woId: string) => {
    const photos = photosUploaded[woId];
    if (!photos?.before || !photos?.after) {
      toast({ title: "Photos required", description: "Upload both Before and After photos before finishing.", variant: "destructive" });
      return;
    }
    setCheckedItems({});
    setChecklistWO(woId);
  };

  const handleChecklistComplete = () => {
    if (!checklistWO) return;
    setChecklistWO(null);
    setSignDialogWO(checklistWO);
  };

  const handleFinishConfirm = async () => {
    if (!signDialogWO || !signName.trim()) return;
    await finishWO.mutateAsync({ woId: signDialogWO, signedByName: signName.trim() });
    setSignDialogWO(null);
    setSignName("");
  };

  const allChecked = CHECKLIST_ITEMS.every((item) => checkedItems[item.id]);

  const triggerFileInput = (woId: string, type: "before" | "after") => {
    const key = `${woId}-${type}`;
    fileInputRefs.current[key]?.click();
  };

  // Mobile card view for a single WO
  const MobileWOCard = ({ wo }: { wo: any }) => {
    const cfg = statusConfig[wo.status] || statusConfig.open;
    const woPhotos = photosUploaded[wo.id] || { before: false, after: false };
    const isOpen = wo.status === "open";

    return (
      <Card className={`${isOpen ? "border-destructive bg-destructive/5 animate-pulse" : ""}`}>
        <CardContent className="p-4 space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <span
              className="font-mono font-bold text-lg cursor-pointer hover:underline"
              onClick={() => navigate(`/dashboard/wo/${wo.id}`)}
            >
              WO-{String(wo.wo_number).padStart(4, "0")}
            </span>
            <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>
          </div>

          {/* Info grid */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Machine:</span>
              <p className="font-medium">{wo.machine}</p>
            </div>
            <div>
              <span className="text-muted-foreground">SLA:</span>
              <p><SLACountdown wo={wo} /></p>
            </div>
            <div>
              <span className="text-muted-foreground">Requester:</span>
              <p className="font-medium">{wo.requester_name}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Created:</span>
              <p className="font-medium">{format(new Date(wo.created_at), "dd/MM HH:mm")}</p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground truncate">{wo.description}</p>

          {/* Action buttons - large touch targets */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {wo.status === "open" && (
              <Button
                size="lg"
                className="col-span-2 h-14 text-base font-bold"
                onClick={() => { stopAlertSound(); receiveWO.mutate(wo.id); }}
                disabled={receiveWO.isPending}
              >
                <Phone className="h-5 w-5 mr-2" /> ACCEPT
              </Button>
            )}
            {wo.status === "received" && wo.engineer_id === user?.id && (
              <Button
                size="lg"
                className="col-span-2 h-14 text-base font-bold"
                onClick={() => arriveWO.mutate(wo.id)}
                disabled={arriveWO.isPending}
              >
                <MapPin className="h-5 w-5 mr-2" /> ARRIVED
              </Button>
            )}
            {wo.status === "arrived" && wo.engineer_id === user?.id && (
              <Button
                size="lg"
                className="col-span-2 h-14 text-base font-bold"
                onClick={() => startWO.mutate(wo.id)}
                disabled={startWO.isPending}
              >
                <Play className="h-5 w-5 mr-2" /> START
              </Button>
            )}
            {wo.status === "in_progress" && wo.engineer_id === user?.id && (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-14 text-base"
                  onClick={() => setPartsDialogWO(wo.id)}
                >
                  <Package className="h-5 w-5 mr-2" /> Parts
                </Button>

                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  ref={(el) => { fileInputRefs.current[`${wo.id}-before`] = el; }}
                  onChange={(e) => handlePhotoUpload(e, wo.id, "before")}
                />
                <Button
                  size="lg"
                  variant={woPhotos.before ? "default" : "outline"}
                  className="h-14 text-base"
                  onClick={() => triggerFileInput(wo.id, "before")}
                  disabled={uploadPhoto.isPending}
                >
                  <Camera className="h-5 w-5 mr-2" /> {woPhotos.before ? "✓ Before" : "Before"}
                </Button>

                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  ref={(el) => { fileInputRefs.current[`${wo.id}-after`] = el; }}
                  onChange={(e) => handlePhotoUpload(e, wo.id, "after")}
                />
                <Button
                  size="lg"
                  variant={woPhotos.after ? "default" : "outline"}
                  className="h-14 text-base"
                  onClick={() => triggerFileInput(wo.id, "after")}
                  disabled={uploadPhoto.isPending}
                >
                  <Camera className="h-5 w-5 mr-2" /> {woPhotos.after ? "✓ After" : "After"}
                </Button>

                <Button
                  size="lg"
                  variant="secondary"
                  className="h-14 text-base font-bold"
                  onClick={() => handleFinishClick(wo.id)}
                >
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
            <AlertTitle className="text-lg font-bold">
              ⚠️ {activeWOs.filter(wo => wo.status === "open").length} Open Work Order(s) Waiting!
            </AlertTitle>
            <AlertDescription>
              There are unassigned work orders that need attention.
            </AlertDescription>
          </Alert>
        )}

        <div>
          <h2 className="text-xl md:text-2xl font-bold">Engineer Panel</h2>
          <p className="text-muted-foreground text-sm">View and execute work orders</p>
        </div>

        {/* KPI Cards - 2 cols on mobile, 4 on desktop */}
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

        {/* Work Orders - Cards on mobile, Table on desktop */}
        <Card>
          <CardHeader className="p-4 md:p-6">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardList className="h-5 w-5" />
              Work Orders
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-6 pt-0">
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !activeWOs?.length ? (
              <p className="text-muted-foreground text-center py-8">No open work orders right now.</p>
            ) : isMobile ? (
              /* MOBILE: Large card layout */
              <div className="space-y-3">
                {activeWOs.map((wo) => (
                  <MobileWOCard key={wo.id} wo={wo} />
                ))}
              </div>
            ) : (
              /* DESKTOP: Table layout */
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
                          <td className="p-2 font-mono font-medium cursor-pointer hover:underline" onClick={() => navigate(`/dashboard/wo/${wo.id}`)}>WO-{String(wo.wo_number).padStart(4, "0")}</td>
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
                                <Button size="sm" onClick={() => { stopAlertSound(); receiveWO.mutate(wo.id); }} disabled={receiveWO.isPending}>
                                  <Phone className="h-3 w-3 mr-1" /> Receive
                                </Button>
                              )}
                              {wo.status === "received" && wo.engineer_id === user?.id && (
                                <Button size="sm" onClick={() => arriveWO.mutate(wo.id)} disabled={arriveWO.isPending}>
                                  <MapPin className="h-3 w-3 mr-1" /> Arrived
                                </Button>
                              )}
                              {wo.status === "arrived" && wo.engineer_id === user?.id && (
                                <Button size="sm" onClick={() => startWO.mutate(wo.id)} disabled={startWO.isPending}>
                                  <Play className="h-3 w-3 mr-1" /> Start
                                </Button>
                              )}
                              {wo.status === "in_progress" && wo.engineer_id === user?.id && (
                                <>
                                  <Button size="sm" variant="outline" onClick={() => setPartsDialogWO(wo.id)}>
                                    <Package className="h-3 w-3 mr-1" /> Parts
                                  </Button>
                                  <input
                                    type="file" accept="image/*" capture="environment" className="hidden"
                                    ref={(el) => { fileInputRefs.current[`${wo.id}-before`] = el; }}
                                    onChange={(e) => handlePhotoUpload(e, wo.id, "before")}
                                  />
                                  <Button size="sm" variant={woPhotos.before ? "default" : "outline"} onClick={() => triggerFileInput(wo.id, "before")} disabled={uploadPhoto.isPending}>
                                    <Camera className="h-3 w-3 mr-1" /> {woPhotos.before ? "✓" : "Before"}
                                  </Button>
                                  <input
                                    type="file" accept="image/*" capture="environment" className="hidden"
                                    ref={(el) => { fileInputRefs.current[`${wo.id}-after`] = el; }}
                                    onChange={(e) => handlePhotoUpload(e, wo.id, "after")}
                                  />
                                  <Button size="sm" variant={woPhotos.after ? "default" : "outline"} onClick={() => triggerFileInput(wo.id, "after")} disabled={uploadPhoto.isPending}>
                                    <Camera className="h-3 w-3 mr-1" /> {woPhotos.after ? "✓" : "After"}
                                  </Button>
                                  <Button size="sm" variant="secondary" onClick={() => handleFinishClick(wo.id)}>
                                    <PenTool className="h-3 w-3 mr-1" /> Finish
                                  </Button>
                                </>
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

      {/* Checklist Dialog */}
      <Dialog open={!!checklistWO} onOpenChange={(open) => { if (!open) setChecklistWO(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5" /> Safety Checklist
            </DialogTitle>
            <DialogDescription>Complete all items before finishing the work order.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {CHECKLIST_ITEMS.map((item) => (
              <div key={item.id} className="flex items-center gap-3">
                <Checkbox
                  id={item.id}
                  checked={!!checkedItems[item.id]}
                  onCheckedChange={(checked) => setCheckedItems((prev) => ({ ...prev, [item.id]: !!checked }))}
                />
                <Label htmlFor={item.id} className="cursor-pointer text-base">{item.label}</Label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChecklistWO(null)}>Cancel</Button>
            <Button onClick={handleChecklistComplete} disabled={!allChecked}>
              Continue to Signature
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign Dialog */}
      <Dialog open={!!signDialogWO} onOpenChange={(open) => { if (!open) { setSignDialogWO(null); setSignName(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenTool className="h-5 w-5" /> Confirm & Finish Work Order
            </DialogTitle>
            <DialogDescription>Sign and finish the work order</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Type your full name below to sign and finish this work order.
            </p>
            <div className="space-y-2">
              <Label htmlFor="sign-name">Full Name (Digital Signature)</Label>
              <Input
                id="sign-name"
                placeholder="e.g. John Smith"
                value={signName}
                onChange={(e) => setSignName(e.target.value)}
                autoFocus
              />
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
    </DashboardLayout>
  );
}
