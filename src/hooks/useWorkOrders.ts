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
  operator?: { name: string };
  engineer?: { name: string };
  closer?: { name: string };
}

// Helper to insert a work_order_log entry
async function logWOAction(workOrderId: string, engineerId: string, engineerName: string, action: string) {
  const { error } = await supabase.from("work_order_logs" as any).insert({
    work_order_id: workOrderId,
    engineer_id: engineerId,
    engineer_name: engineerName,
    action,
  } as any);
  if (error) console.error("logWOAction failed:", error);
}

export function useWorkOrders(filter?: { operatorOnly?: boolean; statusIn?: WOStatus[] }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["work_orders", filter],
    queryFn: async () => {
      let q = supabase
        .from("work_orders")
        .select("*, operator:profiles!work_orders_operator_id_fkey(name), engineer:profiles!work_orders_engineer_id_fkey(name), closer:profiles!work_orders_closed_by_fkey(name)")
        .order("created_at", { ascending: false });

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
    mutationFn: async (wo: { requester_name: string; machine: string; description: string; notes?: string; priority?: string }) => {
      const { data, error } = await supabase
        .from("work_orders")
        .insert({ ...wo, operator_id: user!.id, priority: wo.priority || "medium" } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("create", "work_order", undefined, { requester_name: vars.requester_name, machine: vars.machine, description: vars.description, priority: vars.priority });
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
          received_at: now,
          arrived_at: now,
          started_at: now,
        } as any)
        .eq("id", woId)
        .select()
        .single();
      if (error) throw error;
      if (!updated) throw new Error("Work order update failed — no rows affected");
      // Log all three actions for traceability
      await logWOAction(woId, engineerId, engineerName, "received");
      await logWOAction(woId, engineerId, engineerName, "arrived");
      await logWOAction(woId, engineerId, engineerName, "started");
      return { before };
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
      const { error } = await supabase
        .from("work_orders")
        .update({ status: "received" as any, engineer_id: engineerId, engineer_name: engineerName, received_at: new Date().toISOString() } as any)
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

export function useFinishWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ woId, signedByName, engineerId, engineerName }: { woId: string; signedByName: string; engineerId: string; engineerName: string }) => {
      const { data: before } = await supabase.from("work_orders").select("status").eq("id", woId).single();
      const { error } = await supabase
        .from("work_orders")
        .update({ status: "finished" as any, finished_at: new Date().toISOString(), signed_by_name: signedByName } as any)
        .eq("id", woId);
      if (error) throw error;
      await logWOAction(woId, engineerId, engineerName, "finished");
      return { before };
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("finish", "work_order", vars.woId, { before: result.before, after: { status: "finished", signed_by: vars.signedByName }, engineer_id: vars.engineerId, engineer_name: vars.engineerName });
    },
  });
}

export function useCloseWorkOrder() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (woId: string) => {
      const { data: before } = await supabase.from("work_orders").select("status").eq("id", woId).single();
      const { error } = await supabase
        .from("work_orders")
        .update({ status: "closed" as any, closed_by: user!.id, closed_at: new Date().toISOString() } as any)
        .eq("id", woId);
      if (error) throw error;
      return { before };
    },
    onSuccess: (result, woId) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("close", "work_order", woId, { before: result.before, after: { status: "closed" } });
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
    mutationFn: async (woId: string) => {
      const { error } = await supabase
        .from("work_orders")
        .update({ paused_at: new Date().toISOString() } as any)
        .eq("id", woId);
      if (error) throw error;
    },
    onSuccess: (_data, woId) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("pause", "work_order", woId);
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
        .select("*, operator:profiles!work_orders_operator_id_fkey(name), engineer:profiles!work_orders_engineer_id_fkey(name), closer:profiles!work_orders_closed_by_fkey(name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as unknown as WorkOrder;
    },
    enabled: !!id,
  });
}
