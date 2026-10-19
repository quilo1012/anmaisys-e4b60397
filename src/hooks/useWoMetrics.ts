import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { WAREHOUSE_WO_TYPE } from "@/lib/woKinds";

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
    queryFn: async () => {
      // The view has no `wo_type`, and it is security_invoker: the warehouse policy
      // exempts admin, so admin's MTTR and response times took in warehouse orders
      // (74 of 884 on 18/10) that every other role and every other maintenance figure
      // leave out. Their ids are read apart and dropped here, the same rule
      // `useWorkOrders` applies on the server.
      const [rows, warehouse] = await Promise.all([
        fetchAllRows<WoMetrics>({
          range: (a, b) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- view not in the generated types
            let q = (supabase as any).from("v_wo_metrics").select("*");
            if (opts?.from) q = q.gte("created_at", opts.from.toISOString());
            if (opts?.to) q = q.lte("created_at", opts.to.toISOString());
            return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(a, b);
          },
        }),
        fetchAllRows<{ id: string }>({
          range: (a, b) => {
            let q = supabase.from("work_orders").select("id").eq("wo_type", WAREHOUSE_WO_TYPE);
            if (opts?.from) q = q.gte("created_at", opts.from.toISOString());
            if (opts?.to) q = q.lte("created_at", opts.to.toISOString());
            return q.order("id", { ascending: true }).range(a, b) as never;
          },
        }),
      ]);
      if (warehouse.length === 0) return rows;
      const skip = new Set(warehouse.map((w) => w.id));
      return rows.filter((r) => !skip.has(r.id));
    },
    refetchInterval: 60_000,
  });
}
