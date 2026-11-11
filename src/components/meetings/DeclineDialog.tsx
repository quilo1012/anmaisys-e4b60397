import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DECLINE_REASON_MAX } from "@/lib/meetings";

/**
 * Asked before a decline: a reason, optional. Only who organises the meeting (and who
 * manages meetings) reads it; the other participants see only that you declined.
 */
export function DeclineDialog({ open, title, pending, onCancel, onDecline }: {
  open: boolean;
  title: string;
  pending?: boolean;
  onCancel: () => void;
  onDecline: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Decline {title}?</DialogTitle>
          <DialogDescription>The organiser is told. A reason helps, but you can leave it empty.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="decline-reason">Reason (optional)</Label>
          <Textarea
            id="decline-reason"
            value={reason}
            maxLength={DECLINE_REASON_MAX}
            rows={3}
            placeholder="e.g. On holiday that day"
            aria-describedby="decline-reason-help"
            onChange={(e) => setReason(e.target.value)}
          />
          <p id="decline-reason-help" className="text-right text-xs tabular-nums text-muted-foreground">
            {reason.length}/{DECLINE_REASON_MAX} · only the organiser sees it
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>Back</Button>
          <Button variant="destructive" disabled={pending} onClick={() => onDecline(reason.trim())}>Decline</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
