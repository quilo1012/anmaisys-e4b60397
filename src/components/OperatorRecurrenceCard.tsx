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
 * Shows a "Report Recurring Failure" CTA on a finished/closed WO when the
 * current user is the operator who opened it. Creates a NEW WO linked back
 * to the original via recurrence_of_wo_id.
 */
export function OperatorRecurrenceCard({ wo }: Props) {
  const { user, role, profile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  // Detect if a recurrence already exists for this WO
  const { data: existingRecurrence } = useQuery({
    queryKey: ["wo_recurrence", wo.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("work_orders")
        .select("id, wo_number, status, created_at")
        .eq("recurrence_of_wo_id", wo.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; wo_number: number; status: string; created_at: string } | null;
    },
  });

  const createRecurrence = useMutation({
    mutationFn: async () => {
      const finishedTs = wo.finished_at || wo.closed_at;
      const finishedLabel = finishedTs ? new Date(finishedTs).toLocaleString() : "recently";
      const description =
        `RECURRENCE of WO-${String(wo.wo_number).padStart(6, "0")}. ` +
        `Previous fix by ${wo.engineer_name || "engineer"} on ${finishedLabel}. ` +
        `Original problem: ${wo.description}` +
        (reason.trim() ? `\n\nOperator note: ${reason.trim()}` : "");

      // Look up previous engineer to inherit assignment + lock
      const { data: prev } = await (supabase as any)
        .from("work_orders")
        .select("engineer_id, engineer_name, locked_engineer_id")
        .eq("id", wo.id)
        .single();

      const inheritedEngineerId: string | null = prev?.engineer_id ?? null;
      const inheritedEngineerName: string | null = prev?.engineer_name ?? wo.engineer_name ?? null;
      const inheritedLockedId: string | null = prev?.locked_engineer_id ?? inheritedEngineerId;

      const insertPayload: any = {
        machine: wo.machine,
        description,
        requester_name: profile?.name || user!.email || "Operator",
        operator_id: user!.id,
        priority: "high",
        recurrence_of_wo_id: wo.id,
      };

      // If we know the engineer, pre-assign + pre-receive + lock so it shows up
      // immediately on their dashboard with no extra acceptance step.
      if (inheritedEngineerId) {
        insertPayload.engineer_id = inheritedEngineerId;
        insertPayload.engineer_name = inheritedEngineerName;
        insertPayload.locked_engineer_id = inheritedLockedId;
        insertPayload.locked_at = new Date().toISOString();
        insertPayload.status = "received";
        insertPayload.received_at = new Date().toISOString();
      } else {
        insertPayload.status = "open";
      }

      const { data, error } = await (supabase as any)
        .from("work_orders")
        .insert(insertPayload)
        .select("id, wo_number, engineer_id")
        .single();
      if (error) throw error;
      return data as { id: string; wo_number: number; engineer_id: string | null };
    },
    onSuccess: (newWO) => {
      logAuditEvent("wo_recurrence_created", "work_order", newWO.id, {
        original_wo_id: wo.id,
        original_wo_number: wo.wo_number,
      });
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      queryClient.invalidateQueries({ queryKey: ["wo_recurrence", wo.id] });
      toast({
        title: "🔁 Recurrence reported",
        description: `WO-${String(newWO.wo_number).padStart(6, "0")} opened. Engineer has been notified.`,
      });
      setOpen(false);
      setReason("");
      navigate(`/dashboard/wo/${newWO.id}`);
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

  // If a recurrence already exists, show a link instead of the button
  if (existingRecurrence) {
    return (
      <div className="rounded-lg border-2 border-amber-600/60 bg-amber-50 dark:bg-amber-950/20 p-4 print:hidden">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              This order has a recurrence
            </p>
            <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-0.5">
              A follow-up was already opened: WO-{String(existingRecurrence.wo_number).padStart(6, "0")} ({existingRecurrence.status})
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => navigate(`/dashboard/wo/${existingRecurrence.id}`)}
            >
              Open recurrence WO →
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
                If the same problem returns, report it as a recurrence.
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
              This will open a new HIGH-priority work order linked to WO-
              {String(wo.wo_number).padStart(6, "0")} and notify the engineer
              who signed off the previous fix.
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
              Open recurrence WO
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
