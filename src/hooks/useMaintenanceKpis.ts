import { useMemo } from "react";
import { differenceInMinutes } from "date-fns";
import { useAllWoMetrics, type WoMetrics } from "@/hooks/useWoMetrics";
import { useWorkOrders } from "@/hooks/useWorkOrders";

export interface UseMaintenanceKpisArgs {
  from?: Date;
  to?: Date;
  /** Optional London-shift filter applied to a WO's created_at. */
  shift?: "ALL" | "DAY" | "NIGHT";
}

export interface MaintenanceKpis {
  /** Average response time in minutes (created → accepted). */
  avgResponseMin: number;
  /** Average active repair time in minutes (MTTR, pauses excluded). */
  avgMTTRMin: number;
  /** Mean time between failures in minutes (per-machine average of consecutive WO gaps). */
  avgMTBFMin: number;
  isLoading: boolean;
}

/** Detect London-shift ("day" 06:00–17:59, else "night") from an ISO timestamp. */
function londonShift(iso: string | null | undefined): "DAY" | "NIGHT" | null {
  if (!iso) return null;
  try {
    const hourStr = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(iso));
    const h = parseInt(hourStr, 10);
    if (Number.isNaN(h)) return null;
    return h >= 6 && h < 18 ? "DAY" : "NIGHT";
  } catch {
    return null;
  }
}

/**
 * Single source of truth for the maintenance KPI trio (Avg Response, Avg MTTR, Avg MTBF).
 *
 * Reuses `useAllWoMetrics` (v_wo_metrics view) for Response/MTTR and `useWorkOrders`
 * for MTBF (per-machine gap between consecutive created_at). Semantics:
 *  - Excludes `force_closed` WOs from Response/MTTR averages.
 *  - Accepts every numeric non-negative sample (>= 0) — matches the Analytics semantics
 *    so that all pages using this hook show byte-identical numbers.
 *  - MTBF is computed from work_orders.created_at grouped per machine.
 */
export function useMaintenanceKpis(args: UseMaintenanceKpisArgs = {}): MaintenanceKpis {
  const { from, to, shift = "ALL" } = args;
  const { data: metrics, isLoading: metricsLoading } = useAllWoMetrics({ from, to });
  const { data: workOrders, isLoading: woLoading } = useWorkOrders();

  return useMemo(() => {
    const inShift = (iso: string | null | undefined) => {
      if (shift === "ALL") return true;
      const s = londonShift(iso);
      return s === shift;
    };

    const rows: WoMetrics[] = (metrics ?? []).filter(
      (m) => (m as any).status !== "force_closed" && inShift(m.created_at),
    );

    const respVals = rows
      .map((m) => m.response_time_sec)
      .filter((v): v is number => typeof v === "number" && v >= 0);
    const repairVals = rows
      .map((m) => m.active_repair_sec)
      .filter((v): v is number => typeof v === "number" && v >= 0);

    const avgResponseMin = respVals.length
      ? Math.round(respVals.reduce((a, b) => a + b, 0) / respVals.length / 60)
      : 0;
    const avgMTTRMin = repairVals.length
      ? Math.round(repairVals.reduce((a, b) => a + b, 0) / repairVals.length / 60)
      : 0;

    // MTBF: per-machine average gap between consecutive WOs (minutes).
    let avgMTBFMin = 0;
    const inRangeAndShift = (iso: string) => {
      const d = new Date(iso);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return inShift(iso);
    };
    const wos = (workOrders ?? []).filter((w) => inRangeAndShift(w.created_at));
    if (wos.length > 1) {
      const byMachine: Record<string, Date[]> = {};
      wos.forEach((w) => {
        if (!byMachine[w.machine]) byMachine[w.machine] = [];
        byMachine[w.machine].push(new Date(w.created_at));
      });
      let totalGaps = 0;
      let gapCount = 0;
      Object.values(byMachine).forEach((dates) => {
        if (dates.length < 2) return;
        const sorted = dates.sort((a, b) => a.getTime() - b.getTime());
        for (let i = 1; i < sorted.length; i++) {
          totalGaps += differenceInMinutes(sorted[i], sorted[i - 1]);
          gapCount++;
        }
      });
      avgMTBFMin = gapCount ? Math.round(totalGaps / gapCount) : 0;
    }

    return {
      avgResponseMin,
      avgMTTRMin,
      avgMTBFMin,
      isLoading: metricsLoading || woLoading,
    };
  }, [metrics, workOrders, from, to, shift, metricsLoading, woLoading]);
}
