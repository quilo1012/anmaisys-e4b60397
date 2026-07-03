import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  woId: string | null;
  woNumber?: number | null;
  onOpenChange: (open: boolean) => void;
}

export function RejectWoDialog({ woId, woNumber, onOpenChange }: Props) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  const submit = async () => {
    if (!woId) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      toast.error("Please provide a reason (min 3 characters)");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await (supabase.rpc as any)("reject_wo", {
        _wo_id: woId,
        _reason: trimmed,
      });
      if (error) throw error;
      if (data && (data as any).success === false) {
        throw new Error((data as any).error ?? "reject_failed");
      }
      toast.success(`WO ${woNumber ? `#${woNumber}` : ""} rejected`);
      qc.invalidateQueries({ queryKey: ["work_orders"] });
      qc.invalidateQueries({ queryKey: ["engineer_all_orders"] });
      setReason("");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to reject work order");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!woId} onOpenChange={(o) => { if (!o) { setReason(""); onOpenChange(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject Work Order{woNumber ? ` #${woNumber}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reject-reason">Reason for rejection</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this WO is being rejected…"
            rows={4}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting || reason.trim().length < 3}>
            {submitting ? "Rejecting…" : "Confirm Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RejectWoDialog;
