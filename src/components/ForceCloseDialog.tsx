import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, AlertTriangle } from "lucide-react";
import { differenceInMinutes } from "date-fns";
import { useForceCloseWorkOrder, type WorkOrder } from "@/hooks/useWorkOrders";
import { useToast } from "@/hooks/use-toast";

function humanMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h}h ${m}min` : `${h}h`;
}

/**
 * Force close, with the downtime question attached.
 *
 * Force closing used to resume the line silently at the moment of the click, which
 * closed the open stoppage there — an order left open since yesterday booked the
 * whole night as parada the instant someone tidied the board. The person closing it
 * is the one who knows whether the line actually stopped, so they are asked, and the
 * dialog states the number at stake before they answer.
 */
export function ForceCloseDialog({
  wo,
  open,
  onOpenChange,
}: {
  wo: WorkOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const forceClose = useForceCloseWorkOrder();
  const [answer, setAnswer] = useState<"stopped" | "running">("stopped");
  const [note, setNote] = useState("");

  const stoppedAt = (wo as any)?.line_stopped_at as string | null | undefined;
  const openStoppage = !!wo && !!stoppedAt && !(wo as any).line_resumed_at;
  const openMinutes = useMemo(
    () => (openStoppage ? Math.max(0, differenceInMinutes(new Date(), new Date(stoppedAt!))) : 0),
    [openStoppage, stoppedAt],
  );

  const reset = () => { setAnswer("stopped"); setNote(""); };

  const submit = () => {
    if (!wo) return;
    forceClose.mutate(
      { woId: wo.id, lineWasStopped: answer === "stopped", note },
      {
        onSuccess: (res) => {
          toast({
            title: `WO-${String(wo.wo_number).padStart(6, "0")} force closed`,
            description: res?.downtime_events_discarded
              ? `${humanMinutes(res.downtime_minutes_discarded)} of downtime discarded — the line kept running.`
              : "Downtime recorded up to now.",
          });
          reset();
          onOpenChange(false);
        },
        onError: (err: Error) => toast({ title: "Could not force close", description: err.message, variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Force close {wo ? `WO-${String(wo.wo_number).padStart(6, "0")}` : "maintenance order"}?</DialogTitle>
          <DialogDescription>
            The order closes whatever its current status. It keeps its history and the action is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Was the production line stopped for this order?</Label>
            <RadioGroup value={answer} onValueChange={(v) => setAnswer(v as "stopped" | "running")} className="gap-2">
              <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
                <RadioGroupItem value="stopped" className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">Yes — the line was stopped</span>
                  <span className="block text-muted-foreground">
                    Counts as downtime{openStoppage ? `, ${humanMinutes(openMinutes)} up to now` : ""}.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:bg-muted/40">
                <RadioGroupItem value="running" className="mt-0.5" />
                <span className="text-sm">
                  <span className="font-medium">No — the line kept running</span>
                  <span className="block text-muted-foreground">
                    {openStoppage
                      ? `Discards the ${humanMinutes(openMinutes)} of open downtime on this order.`
                      : "No downtime is recorded for this order."}
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>

          {openStoppage && answer === "running" && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-strong">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {humanMinutes(openMinutes)} of recorded stoppage will be deleted from the downtime figures. The audit log
                keeps the amount and who did it.
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="fc-note">Reason (optional)</Label>
            <Textarea
              id="fc-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this order is being closed without being completed…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={forceClose.isPending}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={forceClose.isPending}>
            {forceClose.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Force Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ForceCloseDialog;
