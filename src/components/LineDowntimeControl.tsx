import { useEffect, useMemo, useState } from "react";
import { differenceInMinutes, format } from "date-fns";
import { CheckCircle2, PowerOff, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useDowntimeEvents, useStopLine, useResumeLine } from "@/hooks/useDowntimeEvents";
import { useAuth } from "@/contexts/AuthContext";

interface LineDowntimeControlProps {
  workOrderId: string;
  workOrderStatus: string;
  operatorId?: string | null;
  engineerId?: string | null;
}

/**
 * Multi-cycle line stop/resume control.
 * - Case A: open downtime event exists → "Machine Back to Work" button
 * - Case B: no open event but history exists → "Line stopped again" button
 * - Case C: never stopped on this WO → "Mark line as stopped" button
 *
 * Only the assigned engineer, the operator who opened the WO, managers and
 * admins may interact with the buttons.
 */
export function LineDowntimeControl({
  workOrderId,
  workOrderStatus,
  operatorId,
  engineerId,
}: LineDowntimeControlProps) {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const { data: events } = useDowntimeEvents(workOrderId);
  const stopLine = useStopLine();
  const resumeLine = useResumeLine();

  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [resumeNote, setResumeNote] = useState("");

  // Live timer for currently-open stop
  const [, setTick] = useState(0);
  const openEvent = useMemo(
    () => (events || []).find((e) => !e.resumed_at) || null,
    [events],
  );
  const stopCount = events?.length || 0;
  const totalMinutes = useMemo(() => {
    if (!events) return 0;
    return events.reduce((sum, e) => {
      if (e.duration_minutes !== null && e.duration_minutes !== undefined) {
        return sum + e.duration_minutes;
      }
      return sum + differenceInMinutes(new Date(), new Date(e.stopped_at));
    }, 0);
  }, [events]);

  useEffect(() => {
    if (!openEvent) return;
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, [openEvent]);

  const canControl = useMemo(() => {
    if (!user) return false;
    if (role === "admin" || role === "manager") return true;
    if (role === "engineer" && engineerId === user.id) return true;
    if (role === "operator" && operatorId === user.id) return true;
    return false;
  }, [user, role, engineerId, operatorId]);

  // Only show control once the WO is in progress (or open with first stop)
  const allowAtThisStatus = ["open", "received", "arrived", "in_progress"].includes(workOrderStatus);
  if (!allowAtThisStatus) return null;

  const handleConfirmStop = async () => {
    try {
      await stopLine.mutateAsync({ workOrderId, reason });
      toast({
        title: "🛑 Line marked as stopped",
        description: stopCount > 0 ? `Stop #${stopCount + 1} recorded` : "First stop recorded for this work order",
        variant: "destructive",
      });
      setStopDialogOpen(false);
      setReason("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleResume = async () => {
    try {
      const updated = await resumeLine.mutateAsync({ workOrderId, note: resumeNote });
      const dur = updated.duration_minutes ?? 0;
      toast({
        title: "✓ Line back to work",
        description: `This stop: ${dur}m. Total stops: ${stopCount}, total downtime: ${totalMinutes}m`,
      });
      setResumeNote("");
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  // CASE A — open stop in progress
  if (openEvent) {
    const liveDur = differenceInMinutes(new Date(), new Date(openEvent.stopped_at));
    return (
      <div className="rounded-lg border-2 border-red-600 bg-red-600/10 p-3 space-y-2">
        <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
          <PowerOff className="h-4 w-4" />
          Line stopped since {format(new Date(openEvent.stopped_at), "HH:mm")} ({liveDur}m ago)
        </p>
        {openEvent.stopped_by_name && (
          <p className="text-xs text-red-700/80">Reported by {openEvent.stopped_by_name}{openEvent.stopped_reason ? ` — "${openEvent.stopped_reason}"` : ""}</p>
        )}
        {canControl && (
          <Button
            size="lg"
            className="w-full h-12 text-base font-bold bg-green-600 hover:bg-green-700 text-white"
            onClick={handleResume}
            disabled={resumeLine.isPending}
          >
            <CheckCircle2 className="h-5 w-5 mr-2" /> MACHINE BACK TO WORK
          </Button>
        )}
      </div>
    );
  }

  // CASE B — no open stop but historical events exist
  if (stopCount > 0) {
    const last = events![events!.length - 1];
    return (
      <>
        <div className="rounded-lg border border-green-600/40 bg-green-600/10 p-3 space-y-2">
          <p className="text-sm font-semibold text-green-700 flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Line in operation
          </p>
          <p className="text-xs text-muted-foreground">
            Last stop: {format(new Date(last.stopped_at), "HH:mm")}
            {last.resumed_at && ` → ${format(new Date(last.resumed_at), "HH:mm")} (${last.duration_minutes ?? 0}m)`}
          </p>
          <p className="text-xs flex items-center gap-1 font-medium text-amber-700">
            <AlertTriangle className="h-3 w-3" /> Stops so far: {stopCount} · total: {totalMinutes}m
          </p>
          {canControl && (
            <Button
              size="lg"
              variant="destructive"
              className="w-full h-12 text-base font-bold"
              onClick={() => setStopDialogOpen(true)}
            >
              <PowerOff className="h-5 w-5 mr-2" /> LINE STOPPED AGAIN
            </Button>
          )}
        </div>
        <StopDialog
          open={stopDialogOpen}
          onOpenChange={setStopDialogOpen}
          reason={reason}
          setReason={setReason}
          onConfirm={handleConfirmStop}
          loading={stopLine.isPending}
          stopNumber={stopCount + 1}
        />
      </>
    );
  }

  // CASE C — never stopped
  return (
    <>
      <div className="rounded-md bg-muted/50 px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-green-600" /> Line in operation · no stoppage
        </span>
        {canControl && workOrderStatus === "in_progress" && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setStopDialogOpen(true)}
          >
            <PowerOff className="h-4 w-4 mr-1.5" /> Mark line as stopped
          </Button>
        )}
      </div>
      <StopDialog
        open={stopDialogOpen}
        onOpenChange={setStopDialogOpen}
        reason={reason}
        setReason={setReason}
        onConfirm={handleConfirmStop}
        loading={stopLine.isPending}
        stopNumber={1}
      />
    </>
  );
}

function StopDialog({
  open, onOpenChange, reason, setReason, onConfirm, loading, stopNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reason: string;
  setReason: (v: string) => void;
  onConfirm: () => void;
  loading: boolean;
  stopNumber: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm line stop (#{stopNumber})</DialogTitle>
          <DialogDescription>
            This will start a downtime counter for this work order. You can resume the line whenever the machine is back to work.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="stop-reason">Reason (optional)</Label>
          <Textarea
            id="stop-reason"
            placeholder="e.g. leak returned, pressure dropped, strange noise"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            <PowerOff className="h-4 w-4 mr-1.5" /> Confirm stop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
