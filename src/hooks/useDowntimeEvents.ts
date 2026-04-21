import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAuditEvent } from "@/hooks/useAuditLogs";

export interface DowntimeEvent {
  id: string;
  work_order_id: string;
  stopped_at: string;
  stopped_by: string | null;
  stopped_by_name: string | null;
  stopped_reason: string | null;
  resumed_at: string | null;
  resumed_by: string | null;
  resumed_by_name: string | null;
  resumed_note: string | null;
  duration_minutes: number | null;
  created_at: string;
  is_recurrence?: boolean;
}

export interface DowntimeTotal {
  work_order_id: string;
  stop_count: number;
  total_minutes: number;
  has_open_stop: boolean;
}

/** All downtime events for a work order, oldest → newest. */
export function useDowntimeEvents(workOrderId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["downtime_events", workOrderId],
    queryFn: async () => {
      if (!workOrderId) return [];
      const { data, error } = await (supabase as any)
        .from("downtime_events")
        .select("*")
        .eq("work_order_id", workOrderId)
        .order("stopped_at", { ascending: true });
      if (error) throw error;
      return (data || []) as DowntimeEvent[];
    },
    enabled: !!workOrderId,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!workOrderId) return;
    const channelName = `downtime_events_${workOrderId}_${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "downtime_events", filter: `work_order_id=eq.${workOrderId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["downtime_events", workOrderId] });
          queryClient.invalidateQueries({ queryKey: ["downtime_totals"] });
          queryClient.invalidateQueries({ queryKey: ["work_orders"] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [workOrderId, queryClient]);

  return query;
}

/** Aggregate totals per work order from v_wo_downtime_total view. */
export function useDowntimeTotals(workOrderIds: string[]) {
  const queryClient = useQueryClient();
  const idsKey = [...workOrderIds].sort().join(",");

  const query = useQuery({
    queryKey: ["downtime_totals", idsKey],
    queryFn: async () => {
      if (workOrderIds.length === 0) return {} as Record<string, DowntimeTotal>;
      const { data, error } = await (supabase as any)
        .from("v_wo_downtime_total")
        .select("*")
        .in("work_order_id", workOrderIds);
      if (error) throw error;
      const map: Record<string, DowntimeTotal> = {};
      (data || []).forEach((row: DowntimeTotal) => { map[row.work_order_id] = row; });
      return map;
    },
    enabled: workOrderIds.length > 0,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (workOrderIds.length === 0) return;
    const channelName = `downtime_totals_${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "downtime_events" }, () => {
        queryClient.invalidateQueries({ queryKey: ["downtime_totals"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [idsKey, queryClient, workOrderIds.length]);

  return query;
}

/** Open a new downtime event (line stopped). */
export function useStopLine() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async ({ workOrderId, reason, isRecurrence }: { workOrderId: string; reason?: string; isRecurrence?: boolean }) => {
      // Resolve a real human name: profile context → fresh DB lookup → email local-part as last resort.
      let displayName = profile?.name?.trim() || "";
      if (!displayName && user?.id) {
        const { data: p } = await (supabase as any)
          .from("profiles").select("name").eq("id", user.id).maybeSingle();
        displayName = (p?.name || "").trim();
      }
      if (!displayName) displayName = user?.email?.split("@")[0] || "Unknown";

      const { data, error } = await (supabase as any)
        .from("downtime_events")
        .insert({
          work_order_id: workOrderId,
          stopped_at: new Date().toISOString(),
          stopped_by: user!.id,
          stopped_by_name: displayName,
          stopped_reason: reason?.trim() || null,
          is_recurrence: !!isRecurrence,
        })
        .select()
        .single();
      if (error) throw error;
      return data as DowntimeEvent;
    },
    onSuccess: (evt) => {
      queryClient.invalidateQueries({ queryKey: ["downtime_events", evt.work_order_id] });
      queryClient.invalidateQueries({ queryKey: ["downtime_totals"] });
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("line_stopped", "work_order", evt.work_order_id, {
        downtime_event_id: evt.id,
        reason: evt.stopped_reason,
      });
    },
  });
}

/** Resume the currently open downtime event for a WO. */
export function useResumeLine() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async ({ workOrderId, note }: { workOrderId: string; note?: string }) => {
      // Find the open event
      const { data: openEvt, error: findErr } = await (supabase as any)
        .from("downtime_events")
        .select("*")
        .eq("work_order_id", workOrderId)
        .is("resumed_at", null)
        .order("stopped_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!openEvt) throw new Error("No open downtime event found for this work order");

      const now = new Date().toISOString();
      const { data, error } = await (supabase as any)
        .from("downtime_events")
        .update({
          resumed_at: now,
          resumed_by: user!.id,
          resumed_by_name: profile?.name || (user!.email ? user!.email.split("@")[0] : "Unknown"),
          resumed_note: note?.trim() || null,
        })
        .eq("id", openEvt.id)
        .select()
        .single();
      if (error) throw error;
      return data as DowntimeEvent;
    },
    onSuccess: (evt) => {
      queryClient.invalidateQueries({ queryKey: ["downtime_events", evt.work_order_id] });
      queryClient.invalidateQueries({ queryKey: ["downtime_totals"] });
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      logAuditEvent("line_resumed", "work_order", evt.work_order_id, {
        downtime_event_id: evt.id,
        duration_minutes: evt.duration_minutes,
      });
    },
  });
}
