import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";
import { logAuditEvent } from "@/hooks/useAuditLogs";

export type WOStatus = "open" | "received" | "arrived" | "in_progress" | "finished" | "closed" | "force_closed";

export interface WorkOrder {
  id: string;
  wo_number: number;
  requester_name: string;
  machine: string;
  description: string;
  status: WOStatus;
  priority: string;
  operator_id: string;
  engineer_id: string | null;
  engineer_name: string | null;
  closed_by: string | null;
  signed_by_name: string | null;
  notified_engineers: string[];
  notes: string;
  created_at: string;
  received_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  closed_at: string | null;
  completed_at: string | null;
  paused_at: string | null;
  total_paused_minutes: number;
  recurrence_of_wo_id?: string | null;
  locked_engineer_id?: string | null;
  operator?: { name: string };
  engineer?: { name: string };
  closer?: { name: string };
}

// Helper to insert a work_order_log entry. Idempotent: silently ignores duplicates
// (unique partial index on work_order_id+engineer_id+action prevents repeats).
async function logWOAction(workOrderId: string, engineerId: string, engineerName: string, action: string) {
  const { error } = await supabase.from("work_order_logs" as any).insert({
    work_order_id: workOrderId,
    engineer_id: engineerId,
    engineer_name: engineerName,
    action,
  } as any);
  // 23505 = unique violation → swallow (action already logged for this engineer)
  if (error && (error as any).code !== "23505") {
    console.error("logWOAction failed:", error);
  }
}

export function useWorkOrders(filter?: { operatorOnly?: boolean; statusIn?: WOStatus[] }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["work_orders", filter],
    queryFn: async () => {
      let q = supabase
        .from("work_orders")
        .select("*, operator:profiles!work_orders_operator_id_fkey(name), engineer:engineers!work_orders_engineer_id_fkey(name), closer:profiles!work_orders_closed_by_fkey(name)")
        .order("created_at", { ascending: false })
        .limit(200);

      if (filter?.operatorOnly && user) {
        q = q.eq("operator_id", user.id);
      }
      if (filter?.statusIn && filter.statusIn.length > 0) {
        q = q.in("status", filter.statusIn);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as WorkOrder[];
    },
    enabled: !!user,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const channelName = `work_orders_changes_${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, () => {
        queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return query;
}

export function useCreateWorkOrder() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (wo: { requester_name: string; machine?: string; description: string; notes?: string; priority?: string; created_at?: string; line_stopped?: boolean; line_id?: string | null; mobile_asset_id?: string | null }) => {
      const effectiveCreatedAt = wo.created_at || new Date().toISOString();
      const insertPayload: any = { ...wo, operator_id: user!.id, priority: wo.priority || "medium", created_at: effectiveCreatedAt };
      // machine column is legacy/optional now — keep empty string if not provided
      if (insertPayload.machine == null) insertPayload.machine = "";
      // Strip empty FKs so DB sees NULL (not "")
      if (!insertPayload.line_id) delete insertPayload.line_id;
      if (!insertPayload.mobile_asset_id) delete insertPayload.mobile_asset_id;
      if (wo.line_stopped) {
        insertPayload.line_stopped = true;
        insertPayload.line_stopped_at = effectiveCreatedAt;
        insertPayload.line_stopped_by = user!.id;
        insertPayload.line_resumed_at = null;
        insertPayload.line_resumed_by = null;
      } else {
        insertPayload.line_stopped = false;
        insertPayload.line_stopped_at = null;
        insertPayload.line_stopped_by = null;
        insertPayload.line_resumed_at = null;
        insertPayload.line_resumed_by = null;
      }
      const { data, error } = await supabase
        .from("work_orders")
        .insert(insertPayload)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("create", "work_order", undefined, { requester_name: vars.requester_name, machine: vars.machine, description: vars.description, priority: vars.priority, line_stopped: !!vars.line_stopped });
    },
  });
}

export function useMachineBackToWork() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (woId: string) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from("work_orders")
        .update({
          line_stopped: false,
          line_resumed_at: now,
          line_resumed_by: user!.id,
        } as any)
        .eq("id", woId);
      if (error) throw error;
      return { woId, resumedAt: now };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("machine_back_to_work", "work_order", result.woId, { resumed_at: result.resumedAt });
    },
  });
}

export function useAcceptAndStartWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ woId, engineerId, engineerName }: { woId: string; engineerId: string; engineerName: string }) => {
      const now = new Date().toISOString();
      const { data: before } = await supabase.from("work_orders").select("status, engineer_id").eq("id", woId).single();
      const { data: updated, error } = await supabase
        .from("work_orders")
        .update({
          status: "in_progress" as any,
          engineer_id: engineerId,
          engineer_name: engineerName,
          started_at: now,
        } as any)
        .eq("id", woId)
        .select()
        .single();
      if (error) throw error;
      if (!updated) throw new Error("Work order update failed — no rows affected");
      // Single canonical action per accept+start; no longer log obsolete received/arrived
      await logWOAction(woId, engineerId, engineerName, "started");
      return { before };
    },
    onMutate: async ({ woId }) => {
      await queryClient.cancelQueries({ queryKey: ["work_orders"] });
      const previousData = queryClient.getQueriesData({ queryKey: ["work_orders"] });
      queryClient.setQueriesData({ queryKey: ["work_orders"] }, (old: WorkOrder[] | undefined) => {
        if (!old) return old;
        return old.map((wo) => wo.id === woId ? { ...wo, status: "in_progress" as WOStatus } : wo);
      });
      return { previousData };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        context.previousData.forEach(([key, data]: [any, any]) => {
          queryClient.setQueryData(key, data);
        });
      }
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("accept_and_start", "work_order", vars.woId, {
        before: result.before,
        after: { status: "in_progress" },
        engineer_id: vars.engineerId,
        engineer_name: vars.engineerName,
      });
    },
  });
}

export function useReceiveWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ woId, engineerId, engineerName }: { woId: string; engineerId: string; engineerName: string }) => {
      const { data: before } = await supabase.from("work_orders").select("status, engineer_id").eq("id", woId).single();
      const now = new Date().toISOString();
      // Atomic accept: status + assignment + lock + ack — all in one update so realtime fires once.
      const { error } = await supabase
        .from("work_orders")
        .update({
          status: "received" as any,
          engineer_id: engineerId,
          engineer_name: engineerName,
          received_at: now,
          locked_engineer_id: engineerId,
          locked_at: now,
          engineer_notified_acknowledged_at: now,
        } as any)
        .eq("id", woId);
      if (error) throw error;
      await logWOAction(woId, engineerId, engineerName, "received");
      return { before };
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("receive", "work_order", vars.woId, { before: result.before, after: { status: "received" }, engineer_id: vars.engineerId, engineer_name: vars.engineerName });
    },
  });
}

export function useArriveWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ woId, engineerId, engineerName }: { woId: string; engineerId: string; engineerName: string }) => {
      const { data: before } = await supabase.from("work_orders").select("status").eq("id", woId).single();
      const { error } = await supabase
        .from("work_orders")
        .update({ status: "arrived" as any, arrived_at: new Date().toISOString() } as any)
        .eq("id", woId);
      if (error) throw error;
      await logWOAction(woId, engineerId, engineerName, "arrived");
      return { before };
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("arrive", "work_order", vars.woId, { before: result.before, after: { status: "arrived" }, engineer_id: vars.engineerId, engineer_name: vars.engineerName });
    },
  });
}

export function useStartWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ woId, engineerId, engineerName }: { woId: string; engineerId: string; engineerName: string }) => {
      const { data: before } = await supabase.from("work_orders").select("status").eq("id", woId).single();
      const { error } = await supabase
        .from("work_orders")
        .update({ status: "in_progress" as any, started_at: new Date().toISOString() } as any)
        .eq("id", woId);
      if (error) throw error;
      await logWOAction(woId, engineerId, engineerName, "started");
      return { before };
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("start", "work_order", vars.woId, { before: result.before, after: { status: "in_progress" }, engineer_id: vars.engineerId, engineer_name: vars.engineerName });
    },
  });
}

export class LineStillStoppedError extends Error {
  code = "line_still_stopped" as const;
  constructor(message = "Line is still marked as stopped. Resume the line before finishing the work order.") {
    super(message);
    this.name = "LineStillStoppedError";
  }
}

export function useFinishWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ woId, signedByName, engineerId, engineerName }: { woId: string; signedByName: string; engineerId: string; engineerName: string }) => {
      // GUARD: block finish if line is still marked as stopped
      const { data: woState } = await supabase
        .from("work_orders")
        .select("line_stopped, line_resumed_at")
        .eq("id", woId)
        .single() as any;
      const flagStillStopped = !!woState?.line_stopped && !woState?.line_resumed_at;
      const { count: openDtCount } = await supabase
        .from("downtime_events")
        .select("id", { count: "exact", head: true })
        .eq("work_order_id", woId)
        .is("resumed_at", null) as any;
      if (flagStillStopped || (openDtCount ?? 0) > 0) {
        throw new LineStillStoppedError();
      }

      const { data: before } = await supabase.from("work_orders").select("status, machine, description").eq("id", woId).single();
      const { error } = await supabase
        .from("work_orders")
        .update({ status: "finished" as any, finished_at: new Date().toISOString(), signed_by_name: signedByName } as any)
        .eq("id", woId);
      if (error) throw error;
      await logWOAction(woId, engineerId, engineerName, "finished");

      // Auto-create machine_event
      if (before) {
        const machineName = (before as any).machine;
        const problemDesc = (before as any).description;
        // Find machine_id by name
        const { data: machineRow } = await supabase.from("machines").select("id").eq("name", machineName).single();
        await supabase.from("machine_events" as any).insert({
          machine_id: machineRow?.id || null,
          work_order_id: woId,
          problem_description: problemDesc,
          action_taken: "Repair completed",
          event_type: "repair",
          engineer_id: engineerId,
          engineer_name: engineerName,
        } as any);
      }

      return { before };
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      queryClient.invalidateQueries({ queryKey: ["machine_events"] });
      logAuditEvent("finish", "work_order", vars.woId, { before: result.before, after: { status: "finished", signed_by: vars.signedByName }, engineer_id: vars.engineerId, engineer_name: vars.engineerName });
    },
  });
}

export function useCloseWorkOrder() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ woId, signatureName }: { woId: string; signatureName: string }) => {
      const now = new Date().toISOString();
      const { data: before } = await supabase.from("work_orders").select("status, line_stopped, line_resumed_at").eq("id", woId).single();
      const updatePayload: any = {
        status: "closed",
        closed_by: user!.id,
        closed_at: now,
        operator_signature_name: signatureName,
      };
      if (before?.line_stopped && !before?.line_resumed_at) {
        updatePayload.line_stopped = false;
        updatePayload.line_resumed_at = now;
        updatePayload.line_resumed_by = user!.id;
      }
      const { error } = await supabase
        .from("work_orders")
        .update(updatePayload)
        .eq("id", woId);
      if (error) throw error;
      return { before, closedAt: now };
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("close", "work_order", vars.woId, { before: result.before, after: { status: "closed", operator_signature: vars.signatureName } });
    },
  });
}

export function useCompleteWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ woId, signedByName }: { woId: string; signedByName: string }) => {
      const { error } = await supabase
        .from("work_orders")
        .update({ status: "completed" as any, completed_at: new Date().toISOString(), signed_by_name: signedByName } as any)
        .eq("id", woId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("complete", "work_order", vars.woId, { status: "completed", signed_by: vars.signedByName });
    },
  });
}

export function useForceCloseWorkOrder() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (woId: string) => {
      const { data: before } = await supabase.from("work_orders").select("status").eq("id", woId).single();
      const { error } = await supabase
        .from("work_orders")
        .update({ status: "force_closed" as any, closed_by: user!.id, completed_at: new Date().toISOString() } as any)
        .eq("id", woId);
      if (error) throw error;
      return { before };
    },
    onSuccess: (result, woId) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("force_close", "work_order", woId, { before: result.before, after: { status: "force_closed" } });
    },
  });
}

export function useUpdateWorkOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, requester_name, machine, description, notes, priority }: { id: string; requester_name: string; machine: string; description: string; notes?: string; priority?: string }) => {
      const update: any = { requester_name, machine, description, notes: notes ?? "" };
      if (priority) update.priority = priority;
      const { error } = await supabase
        .from("work_orders")
        .update(update)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("update", "work_order", vars.id, { requester_name: vars.requester_name, machine: vars.machine });
    },
  });
}

export function usePauseWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ woId, pauseReason }: { woId: string; pauseReason?: string }) => {
      const update: any = { paused_at: new Date().toISOString() };
      if (pauseReason) update.pause_reason = pauseReason;
      const { error } = await supabase
        .from("work_orders")
        .update(update)
        .eq("id", woId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("pause", "work_order", vars.woId, { reason: vars.pauseReason });
    },
  });
}

export function useResumeWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (woId: string) => {
      const { data: wo } = await supabase.from("work_orders").select("paused_at, total_paused_minutes").eq("id", woId).single();
      if (!wo || !wo.paused_at) throw new Error("WO is not paused");
      const pausedMinutes = Math.round((Date.now() - new Date(wo.paused_at).getTime()) / 60000);
      const newTotal = (wo.total_paused_minutes || 0) + pausedMinutes;
      const { error } = await supabase
        .from("work_orders")
        .update({ paused_at: null, total_paused_minutes: newTotal } as any)
        .eq("id", woId);
      if (error) throw error;
    },
    onSuccess: (_data, woId) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("resume", "work_order", woId);
    },
  });
}

export function useDeleteWorkOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Delete related records from tables without ON DELETE CASCADE
      await supabase.from("wo_messages").delete().eq("work_order_id", id);
      await supabase.from("checklist_responses").delete().eq("work_order_id", id);
      await supabase.from("machine_events" as any).delete().eq("work_order_id", id);
      await supabase.from("work_order_logs" as any).delete().eq("work_order_id", id);
      await supabase.from("wo_photos").delete().eq("work_order_id", id);
      // Now delete the WO (parts_used + downtime cascade automatically)
      const { error } = await supabase.from("work_orders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("delete", "work_order", id);
    },
  });
}

export function useWorkOrderById(id: string) {
  return useQuery({
    queryKey: ["work_orders", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*, operator:profiles!work_orders_operator_id_fkey(name), engineer:engineers!work_orders_engineer_id_fkey(name), closer:profiles!work_orders_closed_by_fkey(name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as unknown as WorkOrder;
    },
    enabled: !!id,
  });
}
