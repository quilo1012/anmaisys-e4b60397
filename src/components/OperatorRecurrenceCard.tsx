import { useState } from "react";

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
 * Shows a "Report Recurring Failure" CTA on a finished/closed WO when the
 * current user is the operator who opened it. Creates a NEW WO linked back
 * to the original via recurrence_of_wo_id.
 */
export function OperatorRecurrenceCard({ wo }: Props) {
  const { user, role } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  // Count existing retriggers (logged events) for this WO
  const { data: retriggerCount } = useQuery({
    queryKey: ["wo_retriggers", wo.id],
    queryFn: async () => {
      const { count, error } = await (supabase as any)
        .from("work_order_logs")
        .select("id", { count: "exact", head: true })
        .eq("work_order_id", wo.id)
        .like("action", "problem_retriggered%");
      if (error) throw error;
      return count ?? 0;
    },
  });

  const createRecurrence = useMutation({
    mutationFn: async () => {
      // Append a "problem_retriggered" event to the existing WO instead of
      // reopening it (avoids FK violations on locked_engineer_id).
      const { data, error } = await (supabase as any).rpc("log_wo_retrigger", {
        _wo_id: wo.id,
        _reason: reason.trim() || "Same problem reported again",
      });
      if (error) throw error;
      if (!data?.success) {
        throw new Error(data?.error || "Failed to log recurrence");
      }
      return data as { success: true; wo_number: number; retrigger_count: number };
    },
    onSuccess: (res) => {
      logAuditEvent("wo_problem_retriggered", "work_order", wo.id, {
        wo_number: wo.wo_number,
        retrigger_count: res.retrigger_count,
      });
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      queryClient.invalidateQueries({ queryKey: ["work_order", wo.id] });
      queryClient.invalidateQueries({ queryKey: ["wo_logs", wo.id] });
      queryClient.invalidateQueries({ queryKey: ["work_order_logs", wo.id] });
      toast({
        title: "🔁 Recurrence logged",
        description: `Event added to existing Order #WO-${String(wo.wo_number).padStart(6, "0")}`,
      });
      setOpen(false);
      setReason("");
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
                If the same problem returns, log it as a recurrence on this order.
                {retriggerCount && retriggerCount > 0 ? (
                  <> · <span className="font-semibold">{retriggerCount} previous recurrence{retriggerCount === 1 ? "" : "s"} logged</span></>
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
              This will add a recurrence event to existing Order WO-
              {String(wo.wo_number).padStart(6, "0")} and append it to the order's history. No new work order will be created.
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
              Confirm Recurrence
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
