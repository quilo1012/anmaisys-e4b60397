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
  wo_type?: "production" | "warehouse_service";
  warehouse_location?: string | null;
  locked_engineer_id?: string | null;
  operator?: { name: string };
  engineer?: { name: string };
  closer?: { name: string };
}

// Helper to insert a work_order_log entry. Idempotent: silently ignores duplicates.
// engineer_id MUST be a valid id from the standalone engineers table (FK constraint).
// PIN verification (verify_pin_by_code) returns the engineer.id used here.
async function logWOAction(workOrderId: string, engineerId: string, engineerName: string, action: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) {
    console.warn("logWOAction skipped: no authenticated user");
    return;
  }
  if (!engineerId) {
    console.warn("logWOAction skipped: missing engineerId");
    return;
  }
  const { error } = await supabase.from("work_order_logs" as any).insert({
    work_order_id: workOrderId,
    engineer_id: engineerId,
    engineer_name: engineerName,
    action,
  } as any);
  // 23505 = unique violation → swallow (action already logged for this engineer)
  // 23503 = foreign key violation → the work order was deleted while this
  // engineer still had it on screen. There is nothing left to attach a log to,
  // and the engineer's action already failed for the same reason, so reporting
  // this as a second failure only adds noise.
  const code = (error as { code?: string } | null)?.code;
  if (error && code !== "23505" && code !== "23503") {
    console.error("logWOAction failed:", error);
  } else if (code === "23503") {
    console.warn("logWOAction skipped: work order no longer exists", workOrderId);
  }
}

export function useWorkOrders(filter?: {
  operatorOnly?: boolean;
  statusIn?: WOStatus[];
  lineId?: string | null;
  /**
   * Date window, applied server-side. Pass it whenever the caller reports over a
   * period rather than showing a live worklist.
   *
   * Without it the query returns the 200 most recent orders, which is right for
   * an operator or engineer screen but silently wrong for a report: with 339
   * orders on file, that cap reached back only about seven weeks, so a 90-day
   * view computed its KPIs from 200 of 322 orders and said nothing about the 122
   * it dropped. Filtering server-side means the range decides what is loaded.
   */
  from?: Date;
  to?: Date;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["work_orders", filter],
    queryFn: async () => {
      const ranged = !!(filter?.from || filter?.to);
      let q = supabase
        .from("work_orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(ranged ? 5000 : 200);
      if (filter?.from) q = q.gte("created_at", filter.from.toISOString());
      if (filter?.to) q = q.lte("created_at", filter.to.toISOString());

      // Device line scoping (operator tablets) — takes precedence over operatorOnly self-filter
      if (filter?.lineId) {
        q = q.eq("line_id", filter.lineId);
      } else if (filter?.operatorOnly && user) {
        q = q.eq("operator_id", user.id);
      }
      if (filter?.statusIn && filter.statusIn.length > 0) {
        q = q.in("status", filter.statusIn);
      }

      const { data, error } = await q;
      if (error) {

        console.error("[useWorkOrders] query error:", error);
        throw error;
      }

      const rows = (data || []) as unknown as WorkOrder[];
      const [profilesRes, engineersRes] = await Promise.all([
        supabase.rpc("list_active_profile_names"),
        supabase.rpc("list_engineer_names"),
      ]);

      const profileNames = new Map((profilesRes.data || []).map((p) => [p.id, p.name]));
      const engineerNames = new Map((engineersRes.data || []).map((e) => [e.id, e.name]));

      return rows.map((wo) => ({
        ...wo,
        operator: { name: profileNames.get(wo.operator_id) || wo.requester_name || "Operator" },
        engineer: wo.engineer_id
          ? { name: wo.engineer_name || engineerNames.get(wo.engineer_id) || profileNames.get(wo.engineer_id) || "Engineer" }
          : undefined,
        closer: wo.closed_by ? { name: profileNames.get(wo.closed_by) || "Closer" } : undefined,
      }));
    },
    enabled: !!user,
    refetchInterval: 30_000,
    staleTime: 15_000,
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
    mutationFn: async (wo: { requester_name: string; machine?: string; description: string; notes?: string; priority?: string; created_at?: string; line_stopped?: boolean; line_id?: string | null; mobile_asset_id?: string | null; physical_line_id?: string | null; wo_type?: "production" | "warehouse_service"; warehouse_location?: string | null }) => {
      const effectiveCreatedAt = wo.created_at || new Date().toISOString();
      const isWarehouse = wo.wo_type === "warehouse_service";
      const insertPayload: any = { ...wo, operator_id: user!.id, priority: wo.priority || "medium", created_at: effectiveCreatedAt, wo_type: wo.wo_type || "production" };
      // machine column is legacy/optional now — keep empty string if not provided
      if (insertPayload.machine == null) insertPayload.machine = "";
      // Strip empty FKs so DB sees NULL (not "")
      if (!insertPayload.line_id) delete insertPayload.line_id;
      if (!insertPayload.mobile_asset_id) delete insertPayload.mobile_asset_id;
      if (!insertPayload.physical_line_id) delete insertPayload.physical_line_id;
      if (isWarehouse) {
        // Warehouse service requests must NEVER be tied to a production line
        // and must NEVER contribute to line downtime.
        delete insertPayload.line_id;
        delete insertPayload.physical_line_id;
        // machine (legacy) may hold an optional warehouse asset name — keep as passed
        insertPayload.line_stopped = false;
        insertPayload.line_stopped_at = null;
        insertPayload.line_stopped_by = null;
        insertPayload.line_resumed_at = null;
        insertPayload.line_resumed_by = null;
      } else if (wo.line_stopped) {
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
      const { data: { user } } = await supabase.auth.getUser();
      const authUid = user?.id;
      if (!authUid) throw new Error("Not authenticated");
      const { data: before } = await supabase.from("work_orders").select("status, engineer_id").eq("id", woId).single();
      const { data: updated, error } = await supabase
        .from("work_orders")
        .update({
          status: "in_progress" as any,
          engineer_id: engineerId,
          engineer_name: engineerName,
          started_at: now,
          locked_engineer_id: authUid,
          locked_at: now,
        } as any)
        .eq("id", woId)
        .select()
        .single();
      if (error) throw error;
      if (!updated) throw new Error("Maintenance order update failed — no rows affected");
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
      const { data: { user } } = await supabase.auth.getUser();
      const authUid = user?.id;
      if (!authUid) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("work_orders")
        .update({
          status: "received" as any,
          engineer_id: engineerId,
          engineer_name: engineerName,
          received_at: now,
          locked_engineer_id: authUid,
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
      const { data: { user } } = await supabase.auth.getUser();
      const authUid = user?.id;
      if (!authUid) throw new Error("Not authenticated");
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
      const { data: { user } } = await supabase.auth.getUser();
      const authUid = user?.id;
      if (!authUid) throw new Error("Not authenticated");
      const { data: before } = await supabase.from("work_orders").select("status").eq("id", woId).single();
      const { error } = await supabase
        .from("work_orders")
        .update({
          status: "in_progress" as any,
          started_at: new Date().toISOString(),
          engineer_id: engineerId,
          engineer_name: engineerName,
          locked_engineer_id: authUid,
          locked_at: new Date().toISOString(),
        } as any)
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
  constructor(message = "Line is still marked as stopped. Resume the line before finishing the maintenance order.") {
    super(message);
    this.name = "LineStillStoppedError";
  }
}

export function useFinishWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ woId, signedByName, engineerId, engineerName, resolutionNotes }: { woId: string; signedByName: string; engineerId: string; engineerName: string; resolutionNotes?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const authUid = user?.id;
      if (!authUid) throw new Error("Not authenticated");
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

      const { data: before } = await supabase.from("work_orders").select("status, machine, description, notes").eq("id", woId).single();

      // Append the engineer's resolution notes to any existing notes (preserves earlier observations / pause reasons).
      const trimmedNotes = (resolutionNotes ?? "").trim();
      const prevNotes = ((before as any)?.notes ?? "").toString().trim();
      const stamp = new Date().toLocaleString();
      const resolutionBlock = trimmedNotes
        ? `[Resolution — ${stamp} — ${engineerName}]\n${trimmedNotes}`
        : "";
      const mergedNotes = [prevNotes, resolutionBlock].filter(Boolean).join("\n\n");

      const { error } = await supabase
        .from("work_orders")
        .update({
          status: "finished" as any,
          finished_at: new Date().toISOString(),
          signed_by_name: signedByName,
          ...(resolutionBlock ? { notes: mergedNotes } : {}),
        } as any)
        .eq("id", woId);
      if (error) throw error;
      await logWOAction(woId, engineerId, engineerName, "finished");

      // Auto-create machine_event with the action_taken filled from the resolution notes.
      if (before) {
        const machineName = (before as any).machine;
        const problemDesc = (before as any).description;
        const { data: machineRow } = await supabase.from("machines").select("id").eq("name", machineName).single();
        await supabase.from("machine_events" as any).insert({
          machine_id: machineRow?.id || null,
          work_order_id: woId,
          problem_description: problemDesc,
          action_taken: trimmedNotes || "Repair completed",
          event_type: "repair",
          engineer_id: authUid,
          engineer_name: engineerName,
        } as any);
      }

      return { before };
    },
    onSuccess: (result, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      queryClient.invalidateQueries({ queryKey: ["machine_events"] });
      logAuditEvent("finish", "work_order", vars.woId, { before: result.before, after: { status: "finished", signed_by: vars.signedByName, resolution: vars.resolutionNotes }, engineer_id: vars.engineerId, engineer_name: vars.engineerName });
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
      // .select() so an RLS-blocked update (0 rows, no error) is caught instead
      // of reporting a false "closed" — e.g. a role without a work_orders UPDATE
      // policy would otherwise see a success toast while the WO stays open.
      const { data, error } = await supabase
        .from("work_orders")
        .update(updatePayload)
        .eq("id", woId)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("You don't have permission to close this maintenance order.");
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

export interface ForceCloseResult {
  wo_number: number;
  line_was_stopped: boolean;
  downtime_events_discarded: number;
  downtime_minutes_discarded: number;
}

/**
 * Force close an order, saying whether the line was really stopped.
 *
 * `lineWasStopped: true` closes the open stoppage at this moment — the parada was
 * real and belongs in the downtime figures. `false` discards it: an order raised
 * while the line kept running, or a test, should not book the hours between when it
 * was opened and when someone tidied up the board.
 *
 * Both branches run in one database function: discarding needs a DELETE on
 * downtime_events that no role holds from the browser, and the status change must
 * not apply without the downtime decision that goes with it.
 */
export function useForceCloseWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ woId, lineWasStopped, note }: { woId: string; lineWasStopped: boolean; note?: string }) => {
      const { data, error } = await (supabase as any).rpc("force_close_work_order", {
        _wo_id: woId,
        _line_was_stopped: lineWasStopped,
        _note: note?.trim() || null,
      });
      if (error) throw error;
      return data as ForceCloseResult;
    },
    onSuccess: () => {
      // The function writes its own audit row — it knows what it discarded, which a
      // client-side log could only guess at.
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      queryClient.invalidateQueries({ queryKey: ["downtime"] });
      queryClient.invalidateQueries({ queryKey: ["downtime_events"] });
    },
  });
}

export function useEngineerList() {
  return useQuery({
    queryKey: ["engineers_assignable"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_engineers");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string }[];
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Hand an unaccepted order to an engineer.
 *
 * Accepting was the engineer's move alone, so an order nobody picked up had no way
 * out but waiting — WO-605 sat open from 29/07 13:04 until the next morning. This is
 * not acceptance: the order stays open and the engineer still accepts it. What
 * changes is that it belongs to someone, it rings in their alerts, and the delay
 * stops being nobody's fault.
 */
export function useAssignWorkOrderEngineer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ woId, engineerId }: { woId: string; engineerId: string }) => {
      const { data, error } = await (supabase as any).rpc("assign_work_order_engineer", {
        _wo_id: woId,
        _engineer_id: engineerId,
      });
      if (error) throw error;
      return data as { wo_number: number; engineer_name: string };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work_orders"] }),
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

/**
 * Board stages, in the order work really moves through them. Used by the Kanban
 * drag-and-drop to decide what a drop is allowed to mean.
 */
export const WO_STAGES = ["open", "received", "in_progress", "finished", "closed"] as const;
export type WOStage = (typeof WO_STAGES)[number];

/** Which stage a status belongs to; "arrived" shares a column with "received". */
export function stageOfStatus(status: string): WOStage {
  if (status === "arrived") return "received";
  if (status === "completed" || status === "force_closed") return "closed";
  return (WO_STAGES as readonly string[]).includes(status) ? (status as WOStage) : "open";
}

/**
 * Move an order one stage along the board.
 *
 * Deliberately not a bare status write. Each stage owns a timestamp that the
 * KPIs are computed from — response time reads received_at, MTTR reads
 * started_at and finished_at — so dropping a card straight from Open onto
 * Finished would leave those null and quietly corrupt every average that
 * depends on them. Only adjacent moves are accepted, and each one stamps its
 * own time if it is not already set. Backwards by one stage is allowed so a
 * mis-drop can be undone; the timestamps already recorded are left alone,
 * because they did happen.
 */
export function useMoveWorkOrderStage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ wo, to }: { wo: WorkOrder; to: WOStage }) => {
      const from = stageOfStatus(wo.status);
      if (from === to) return;
      const fromIdx = WO_STAGES.indexOf(from);
      const toIdx = WO_STAGES.indexOf(to);
      if (Math.abs(toIdx - fromIdx) !== 1) {
        const next = WO_STAGES[fromIdx + (toIdx > fromIdx ? 1 : -1)];
        throw new Error(`Move it to ${next.replace(/_/g, " ")} first — stages are recorded one at a time.`);
      }

      const now = new Date().toISOString();
      const patch: Record<string, string> = { status: to };
      if (to === "received" && !wo.received_at) patch.received_at = now;
      if (to === "in_progress" && !wo.started_at) patch.started_at = now;
      if (to === "finished" && !wo.finished_at) patch.finished_at = now;
      if (to === "closed" && !wo.closed_at) patch.closed_at = now;

      const { error } = await supabase.from("work_orders").update(patch as never).eq("id", wo.id);
      if (error) throw error;
      return { from, to };
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("update", "work_order", vars.wo.id, { moved_to: vars.to, via: "board" });
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
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;

      const wo = data as unknown as WorkOrder;
      const [profilesRes, engineersRes] = await Promise.all([
        supabase.rpc("list_active_profile_names"),
        supabase.rpc("list_engineer_names"),
      ]);
      const profileNames = new Map((profilesRes.data || []).map((p) => [p.id, p.name]));
      const engineerNames = new Map((engineersRes.data || []).map((e) => [e.id, e.name]));

      return {
        ...wo,
        operator: { name: profileNames.get(wo.operator_id) || wo.requester_name || "Operator" },
        engineer: wo.engineer_id
          ? { name: wo.engineer_name || engineerNames.get(wo.engineer_id) || profileNames.get(wo.engineer_id) || "Engineer" }
          : undefined,
        closer: wo.closed_by ? { name: profileNames.get(wo.closed_by) || "Closer" } : undefined,
      } as WorkOrder;
    },
    enabled: !!id,
  });
}
