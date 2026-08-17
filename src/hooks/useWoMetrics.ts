import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";

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

/**
 * All WO metrics, optionally restricted to a date range on created_at.
 *
 * Paged, not capped. It asked for `.limit(1000)`, which is not a limit anyone chose —
 * it is the same number PostgREST would have imposed anyway, written out. Every
 * maintenance figure in the app is computed from these rows: MTTR, MTBF, average
 * response, the engineer ranking. Past a thousand work orders in the range they would
 * all have been computed over whichever thousand came back, with nothing on screen
 * saying so. At ~114 a month that was a matter of when, not whether — and "All time"
 * became a real preset the day the date filter was fixed.
 *
 * Ordered because paging without it is worse than not paging: two pages of an
 * unordered result can repeat one row and skip another. `id` breaks ties so the sort
 * is total — work orders created in the same second are not rare.
 */
export function useAllWoMetrics(opts?: { from?: Date; to?: Date }) {
  const fromKey = opts?.from?.toISOString() ?? "all";
  const toKey = opts?.to?.toISOString() ?? "all";
  return useQuery({
    queryKey: ["wo_metrics_all", fromKey, toKey],
    queryFn: () => fetchAllRows<WoMetrics>({
      range: (a, b) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view not in the generated types
        let q = (supabase as any).from("v_wo_metrics").select("*");
        if (opts?.from) q = q.gte("created_at", opts.from.toISOString());
        if (opts?.to) q = q.lte("created_at", opts.to.toISOString());
        return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b);
      },
    }),
    refetchInterval: 60_000,
  });
}
