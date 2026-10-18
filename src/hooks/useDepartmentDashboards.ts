import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WAREHOUSE_WO_TYPE } from "@/lib/woKinds";
import { CLOSED_STATUSES } from "@/lib/maintenanceProblemAnalysis";

/**
 * A read the Maintenance dashboard needed that no screen made already. Every other
 * figure on the department dashboards comes from the hooks the module's own screens
 * use, so the dashboard and the screen behind each card share a cache and a rule. (The
 * board trend is in `useHeadcount`, beside the board's other reads: it reads
 * `employees`, which only the HR-gated hooks may.)
 */

/**
 * Maintenance orders finished inside a window, counted by when they were finished.
 *
 * The analysis rows are filed by when an order was raised, which is right for "what
 * broke this month" and wrong for "what got done today": an order raised on Friday and
 * finished on Monday is Monday's work. A count, not rows — the card needs one number.
 * Warehouse orders are not maintenance and stay out, as on every maintenance screen.
 */
export function useWoFinishedCount(from: Date, to: Date, enabled = true) {
  const f = from.toISOString();
  const t = to.toISOString();
  return useQuery({
    queryKey: ["dept-dashboard", "wo-finished", f, t],
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("work_orders")
        .select("id", { count: "exact", head: true })
        .in("status", CLOSED_STATUSES as never)
        .neq("wo_type", WAREHOUSE_WO_TYPE)
        .gte("finished_at", f)
        .lte("finished_at", t);
      if (error) throw error;
      return count ?? 0;
    },
  });
}
