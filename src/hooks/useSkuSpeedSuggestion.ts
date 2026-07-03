import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type SkuSpeedSuggestion = {
  avg_uph: number;
  sample_size: number;
  window_days: number;
};

/**
 * Returns the 30-day moving average units-per-hour for a given SKU on a given line,
 * from `sku_production_history`. Used by Planner and Production Control to suggest
 * realistic targets and highlight when the current run is significantly below average.
 */
export function useSkuSpeedSuggestion(
  lineId: string | null | undefined,
  skuId: string | null | undefined,
  days = 30,
) {
  return useQuery<SkuSpeedSuggestion | null>({
    queryKey: ["sku-speed-suggestion", lineId, skuId, days],
    enabled: !!lineId && !!skuId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_sku_speed_suggestion", {
        _line_id: lineId!,
        _sku_id: skuId!,
        _days: days,
      });
      if (error) throw error;
      return (data ?? null) as SkuSpeedSuggestion | null;
    },
  });
}

/** Returns true if `currentUph` is more than `thresholdPct` (default 15%) below `avgUph`. */
export function isBelowHistoricalAverage(
  currentUph: number,
  avgUph: number,
  thresholdPct = 0.15,
): boolean {
  if (!avgUph || avgUph <= 0 || !currentUph || currentUph <= 0) return false;
  return currentUph < avgUph * (1 - thresholdPct);
}
