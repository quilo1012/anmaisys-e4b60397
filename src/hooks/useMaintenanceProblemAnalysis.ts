import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { WAREHOUSE_WO_TYPE } from "@/lib/woKinds";
import { useWorkOrders } from "@/hooks/useWorkOrders";
import { useAllWoMetrics } from "@/hooks/useWoMetrics";
import { useProblemDescriptions } from "@/hooks/useProblemDescriptions";
import {
  ACTIVE_STATUSES,
  buildRows,
  problemKey,
  type AnalysisMetrics,
  type AnalysisRow,
  type AnalysisWorkOrder,
} from "@/lib/maintenanceProblemAnalysis";

/**
 * Every order still needing an engineer, whenever it was raised.
 *
 * Its own query because "open orders for this problem" and "orders raised in the
 * period" are different questions: a fault reported six weeks ago and still open is
 * not in a 30-day window. Paged — the unranged useWorkOrders stops at 200.
 */
function useAllActiveWorkOrders() {
  return useQuery({
    queryKey: ["work_orders", "maintenance-analysis", "active"],
    queryFn: () =>
      fetchAllRows<AnalysisWorkOrder>({
        range: (a, b) =>
          supabase
            .from("work_orders")
            .select("*")
            .in("status", ACTIVE_STATUSES as never)
            .neq("wo_type", WAREHOUSE_WO_TYPE)
            .order("created_at", { ascending: false })
            .order("id", { ascending: true })
            .range(a, b) as never,
      }),
    refetchInterval: 60_000,
  });
}

/**
 * The orders raised in [from, to] (on created_at — the moment the fault was
 * reported), with their recorded repair time attached, plus every currently active
 * order. Warehouse orders are excluded, as in every other maintenance figure.
 */
export function useMaintenanceProblemAnalysis(range: { from?: Date; to?: Date }) {
  // "All time" still has to be a range: without one useWorkOrders returns only the
  // 200 newest orders, and the totals would be over whichever 200 those were.
  const from = range.from ?? new Date(0);
  const wo = useWorkOrders({ from, to: range.to });
  const metrics = useAllWoMetrics({ from, to: range.to });
  const active = useAllActiveWorkOrders();
  const problems = useProblemDescriptions();

  const categoryByProblem = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const p of problems.data ?? []) m.set(problemKey(p.name), p.category ?? null);
    return m;
  }, [problems.data]);

  const rows: AnalysisRow[] = useMemo(
    () =>
      buildRows(
        (wo.data ?? []) as unknown as AnalysisWorkOrder[],
        (metrics.data ?? []) as AnalysisMetrics[],
        categoryByProblem,
      ),
    [wo.data, metrics.data, categoryByProblem],
  );

  const activeRows: AnalysisRow[] = useMemo(
    () => buildRows(active.data ?? [], [], categoryByProblem),
    [active.data, categoryByProblem],
  );

  return {
    rows,
    activeRows,
    isLoading: wo.isLoading || metrics.isLoading || active.isLoading,
    error: (wo.error ?? metrics.error ?? active.error) as Error | null,
    refetch: () => { void wo.refetch(); void metrics.refetch(); void active.refetch(); },
  };
}
