import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, RotateCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { logAuditEvent } from "@/hooks/useAuditLogs";

interface Props {
  wo: {
    id: string;
    wo_number: number;
    status: string;
    machine: string;
    description: string;
    operator_id: string;
    engineer_name: string | null;
    finished_at: string | null;
    closed_at: string | null;
    priority: string;
  };
}

/**
 * "Report Recurring Failure" CTA shown on a finished/closed WO.
 *
 * Calls the SECURITY DEFINER RPC `reopen_wo_as_recurrence`, which creates a
 * NEW work order in `open` status linked to the original via
 * `recurrence_of_wo_id`. The new WO then flows through the normal engineer
 * lifecycle (accept → start → finish), and we navigate the operator to it.
 *
 * This replaces the old `log_wo_retrigger` flow, which violated the FK
 * `work_order_logs.engineer_id → engineers.id` whenever the caller's
 * `auth.uid()` did not exist in the standalone `engineers` table.
 */
export function OperatorRecurrenceCard({ wo }: Props) {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  // Count episodes (recurrences) for this WO. Episode 1 = original; >1 = reopens.
  const { data: recurrenceCount } = useQuery({
    queryKey: ["wo_recurrences", wo.id],
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from("wo_episodes")
        .select("id", { count: "exact", head: true })
        .eq("work_order_id", wo.id);
      if (error) throw error;
      // Subtract the initial episode so we report only the *re*opens.
      return Math.max(0, (count ?? 0) - 1);
    },
  });

  const createRecurrence = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("reopen_wo_as_recurrence", {
        _wo_id: wo.id,
        _reason: reason.trim() || "Same problem reported again",
      });
      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || "Failed to reopen recurrence");
      }
      return data as {
        success: true;
        wo_id: string;
        wo_number: number;
        episode_number: number;
      };
    },
    onSuccess: (res) => {
      logAuditEvent("wo_recurrence_reopened", "work_order", res.wo_id, {
        wo_number: res.wo_number,
        episode_number: res.episode_number,
      });
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      queryClient.invalidateQueries({ queryKey: ["work_order", wo.id] });
      queryClient.invalidateQueries({ queryKey: ["wo_metrics", wo.id] });
      queryClient.invalidateQueries({ queryKey: ["downtime_events", wo.id] });
      queryClient.invalidateQueries({ queryKey: ["wo_recurrences", wo.id] });
      toast({
        title: "🔁 Recurrence reopened",
        description: `WO-${String(res.wo_number).padStart(6, "0")} reopened (episode #${res.episode_number}). Times will accumulate.`,
      });
      setOpen(false);
      setReason("");
      // Stay on the same WO — it's the SAME order, now reopened.
      navigate(`/dashboard/wo/${res.wo_id}`);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Only operators (who opened the WO), admins, or managers can use this
  const canReport =
    !!user &&
    (role === "admin" ||
      role === "manager" ||
      (role === "operator" && wo.operator_id === user.id));

  if (!canReport) return null;
  if (!["finished", "closed", "completed"].includes(wo.status)) return null;

  const finishedTs = wo.finished_at || wo.closed_at;

  return (
    <>
      <div className="rounded-lg border-2 border-amber-600/60 bg-amber-50 dark:bg-amber-950/20 p-4 print:hidden">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-2">
            <div>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Machine recently repaired
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-200/80">
                Fix signed off by {wo.engineer_name || "engineer"}
                {finishedTs && ` ${formatDistanceToNow(new Date(finishedTs), { addSuffix: true })}`}.
                If the same problem returns, reopen this work order — its time will be
                added to the previous repair (no new WO number).
                {recurrenceCount && recurrenceCount > 0 ? (
                  <> · <span className="font-semibold">{recurrenceCount} previous reopen{recurrenceCount === 1 ? "" : "s"}</span></>
                ) : null}
              </p>
            </div>
            <Button
              size="lg"
              variant="destructive"
              className="w-full h-12 text-base font-bold"
              onClick={() => setOpen(true)}
            >
              <RotateCw className="h-5 w-5 mr-2" /> REPORT RECURRING FAILURE
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!o) setReason(""); setOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report recurring failure</DialogTitle>
            <DialogDescription>
              This will open a NEW work order linked to WO-
              {String(wo.wo_number).padStart(6, "0")} as a recurrence. Engineers will be notified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rec-reason">What is happening now? (optional)</Label>
            <Textarea
              id="rec-reason"
              placeholder="e.g. same noise returned, leak again, stopped under load"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={createRecurrence.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => createRecurrence.mutate()}
              disabled={createRecurrence.isPending}
            >
              {createRecurrence.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4 mr-2" />
              )}
              Open Recurrence
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
