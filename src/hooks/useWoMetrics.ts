import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface WoMetrics {
  id: string;
  wo_number: number;
  machine: string;
  priority: string;
  status: string;
  line_stopped_at: string | null;
  created_at: string;
  accepted_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  line_resumed_at: string | null;
  closed_at: string | null;
  line_downtime_sec: number | null;
  reporting_delay_sec: number | null;
  response_time_sec: number | null;
  travel_time_sec: number | null;
  active_repair_sec: number | null;
  restart_delay_sec: number | null;
  paperwork_delay_sec: number | null;
  total_cycle_sec: number | null;
}

/** Single-WO metrics from v_wo_metrics view. */
export function useWoMetrics(workOrderId: string | undefined) {
  return useQuery({
    queryKey: ["wo_metrics", workOrderId],
    queryFn: async () => {
      if (!workOrderId) return null;
      const { data, error } = await (supabase as any)
        .from("v_wo_metrics")
        .select("*")
        .eq("id", workOrderId)
        .maybeSingle();
      if (error) throw error;
      return data as WoMetrics | null;
    },
    enabled: !!workOrderId,
    refetchInterval: 30_000,
  });
}

/** All WO metrics, optionally restricted to a date range on created_at. */
export function useAllWoMetrics(opts?: { from?: Date; to?: Date }) {
  const fromKey = opts?.from?.toISOString() ?? "all";
  const toKey = opts?.to?.toISOString() ?? "all";
  return useQuery({
    queryKey: ["wo_metrics_all", fromKey, toKey],
    queryFn: async () => {
      let q = (supabase as any).from("v_wo_metrics").select("*");
      if (opts?.from) q = q.gte("created_at", opts.from.toISOString());
      if (opts?.to) q = q.lte("created_at", opts.to.toISOString());
      const { data, error } = await q.limit(1000);
      if (error) throw error;
      return (data || []) as WoMetrics[];
    },
    refetchInterval: 60_000,
  });
}
