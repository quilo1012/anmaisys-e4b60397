import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { logAuditEvent } from "@/hooks/useAuditLogs";
import {
  toExclusionIntervals,
  type ExclusionActivity,
  type ExclusionMap,
} from "@/lib/downtimeExclusions";

export interface WoExclusion {
  id: string;
  work_order_id: string;
  activity: ExclusionActivity | string;
  started_at: string;
  ended_at: string | null;
  started_by: string | null;
  started_by_name: string | null;
  ended_by: string | null;
  note: string | null;
  created_at: string;
}

/** Team-activity exclusions for a single maintenance order, oldest → newest. */
export function useWoExclusions(workOrderId: string | undefined) {
  return useQuery({
    queryKey: ["wo_downtime_exclusions", workOrderId],
    queryFn: async () => {
      if (!workOrderId) return [] as WoExclusion[];
      const { data, error } = await (supabase as any)
        .from("wo_downtime_exclusions")
        .select("*")
        .eq("work_order_id", workOrderId)
        .order("started_at", { ascending: true });
      if (error) throw error;
      return (data || []) as WoExclusion[];
    },
    enabled: !!workOrderId,
    refetchInterval: 30_000,
  });
}

/**
 * All exclusions, grouped and merged per work order. Used by the downtime
 * dashboards/exports so every view subtracts exactly the same minutes.
 */
export function useAllWoExclusions() {
  return useQuery({
    queryKey: ["wo_downtime_exclusions", "all"],
    queryFn: async (): Promise<ExclusionMap> => {
      const { data, error } = await (supabase as any)
        .from("wo_downtime_exclusions")
        .select("work_order_id, started_at, ended_at");
      if (error) throw error;
      const byWo: Record<string, { started_at: string; ended_at: string | null }[]> = {};
      for (const row of (data || []) as any[]) {
        if (!row.work_order_id) continue;
        (byWo[row.work_order_id] ||= []).push(row);
      }
      const map: ExclusionMap = {};
      for (const [woId, rows] of Object.entries(byWo)) {
        map[woId] = toExclusionIntervals(rows);
      }
      return map;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** Start a team activity (opens an exclusion). Only one may be open per WO. */
export function useStartExclusion() {
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();

  return useMutation({
    mutationFn: async ({ workOrderId, activity, note }: {
      workOrderId: string;
      activity: ExclusionActivity;
      note?: string;
    }) => {
      const { data: open } = await (supabase as any)
        .from("wo_downtime_exclusions")
        .select("id")
        .eq("work_order_id", workOrderId)
        .is("ended_at", null)
        .maybeSingle();
      if (open) throw new Error("Another team activity is already running for this order");

      let displayName = profile?.name?.trim() || "";
      if (!displayName && user?.id) {
        const { data: p } = await (supabase as any)
          .from("profiles").select("name").eq("id", user.id).maybeSingle();
        displayName = (p?.name || "").trim();
      }
      if (!displayName) displayName = user?.email?.split("@")[0] || "Unknown";

      const { data, error } = await (supabase as any)
        .from("wo_downtime_exclusions")
        .insert({
          work_order_id: workOrderId,
          activity,
          started_at: new Date().toISOString(),
          started_by: user?.id ?? null,
          started_by_name: displayName,
          note: note?.trim() || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as WoExclusion;
    },
    onSuccess: (row) => {
      invalidate(queryClient, row.work_order_id);
      logAuditEvent("team_activity_started", "work_order", row.work_order_id, {
        exclusion_id: row.id,
        activity: row.activity,
      });
    },
  });
}

/** Close the open team activity (back to stop). */
export function useEndExclusion() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ exclusionId }: { exclusionId: string }) => {
      const { data, error } = await (supabase as any)
        .from("wo_downtime_exclusions")
        .update({ ended_at: new Date().toISOString(), ended_by: user?.id ?? null })
        .eq("id", exclusionId)
        .is("ended_at", null)
        .select()
        .single();
      if (error) throw error;
      return data as WoExclusion;
    },
    onSuccess: (row) => {
      invalidate(queryClient, row.work_order_id);
      const minutes = row.ended_at
        ? Math.round((new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()) / 60_000)
        : 0;
      logAuditEvent("team_activity_ended", "work_order", row.work_order_id, {
        exclusion_id: row.id,
        activity: row.activity,
        minutes,
      });
    },
  });
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>, woId: string) {
  queryClient.invalidateQueries({ queryKey: ["wo_downtime_exclusions"] });
  queryClient.invalidateQueries({ queryKey: ["downtime_events", woId] });
  queryClient.invalidateQueries({ queryKey: ["downtime_totals"] });
  queryClient.invalidateQueries({ queryKey: ["shift_downtime"] });
}
