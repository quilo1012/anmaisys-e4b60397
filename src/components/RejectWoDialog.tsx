import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle } from "lucide-react";
import { concernInDescription, concernWarning, reasonProblemFor } from "@/lib/rejectionGuard";

interface Props {
  woId: string | null;
  woNumber?: number | null;
  /** The operator's own words. Decides whether this is a report that can be waved away. */
  description?: string | null;
  onOpenChange: (open: boolean) => void;
}

export function RejectWoDialog({ woId, woNumber, description, onOpenChange }: Props) {
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  const concern = concernInDescription(description);
  const problem = reasonProblemFor(description, reason);
  const blocked = problem !== null || (concern !== null && !checked);

  const submit = async () => {
    if (!woId) return;
    const trimmed = reason.trim();
    // The old gate was three characters. "Ooo" is three characters, and so is "...",
    // and those are the two reasons that closed a report of an electric shock and a
    // metal detection on Line 1.
    if (problem) {
      toast.error(problem);
      return;
    }
    if (concern && !checked) {
      toast.error("Confirm the check was made before rejecting this one.");
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
      setChecked(false);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to reject maintenance order");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!woId} onOpenChange={(o) => { if (!o) { setReason(""); setChecked(false); onOpenChange(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject Maintenance Order{woNumber ? ` #${woNumber}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {/* Above the box, not under it: after somebody has typed is too late to tell
              them what kind of report they are holding. */}
          {concern && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-strong" />
              <span>{concernWarning(concern)}</span>
            </p>
          )}
          <Label htmlFor="reject-reason">Reason for rejection</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={concern
              ? "Who inspected it, when, and what they found…"
              : "Explain why this WO is being rejected…"}
            rows={4}
            autoFocus
          />
          {/* Says what is missing rather than quoting a rule. "min 3 characters" to
              somebody who typed three characters is what taught the floor to type
              "Ooo" — and it worked, twice. */}
          {reason.trim().length > 0 && problem && (
            <p className="text-xs font-medium text-warning-strong">{problem}</p>
          )}

          {concern && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-xs">
              <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} className="mt-0.5" />
              <span>
                I checked this myself, or watched somebody check it, and the machine is safe to run.
              </span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={submitting || blocked}>
            {submitting ? "Rejecting…" : "Confirm Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RejectWoDialog;
