import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ENGINE_VERSION, type LineNo, type ShiftForecast, type ShiftType } from "@/lib/smartTargetEngine";
import { isEstimateRate, type LineFactor } from "@/lib/smartTargetRates";
import { isCurrentShift } from "@/lib/smartTargetQueue";
import type { StoredForecast } from "@/lib/smartTargetAccuracy";

/**
 * Freezing each shift's forecasts, and reading back the last four weeks of them
 * (Q27a–Q30a, BLOCO 148).
 *
 * While a shift runs, the first time this page has a complete forecast it is saved:
 * one row per planned line, the shown lines and the held-back ones (in shadow). The
 * database keeps the first number per line, so a forecast with a number never changes. Nothing is saved for a past or future shift, and nothing
 * while the iTouch queue is still being read, because the quantities would be missing.
 */

export interface LineToFreeze {
  line: LineNo;
  shown: boolean;
  /** The forecast with the line's own rates, shown or not. */
  forecast: ShiftForecast;
  factor: LineFactor | null;
}

const ACCURACY_DAYS = 28;

/** The last four weeks of kept forecasts, up to `date`. */
export function useSmartTargetForecastRows(date: string) {
  const from = new Date(Date.parse(`${date}T00:00:00Z`) - ACCURACY_DAYS * 86_400_000).toISOString().slice(0, 10);
  return useQuery({
    queryKey: ["smart_target_forecasts", from, date],
    queryFn: async () => {
      // Not in the generated types until BLOCO 148 is applied and types.ts regenerated.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("smart_target_forecasts")
        .select("session_date, shift, line, shown, expected_total, frozen_at, jobs, engine_version")
        .gte("session_date", from)
        .lte("session_date", date)
        .order("session_date");
      if (error) {
        if (error.code === "PGRST205" || error.code === "42P01") return { installed: false, rows: [] as StoredForecast[] };
        throw error;
      }
      return { installed: true, rows: (data ?? []) as StoredForecast[] };
    },
  });
}

type ForecastRows = ReturnType<typeof useSmartTargetForecastRows>;

/**
 * Saves the running shift's forecasts once. Separate from the read because which lines
 * are shown comes from those rows (Q45a), and the forecasts to save depend on it.
 */
export function useFreezeSmartTargetForecasts(date: string, shift: ShiftType, toFreeze: LineToFreeze[] | null, ready: boolean, log: ForecastRows) {
  const qc = useQueryClient();
  // Per line, because a line can get its plan while the page stays open.
  const saved = useRef(new Set<string>());

  useEffect(() => {
    if (!ready || !toFreeze || !log.data?.installed || !isCurrentShift(date, shift)) return;
    const today = log.data.rows.filter((r) => r.session_date === date && r.shift === shift);
    // A forecast with a number never changes. One without a number can be replaced by one
    // with it (Q57a, BLOCO 150).
    const withNumber = new Set(today.filter((r) => r.expected_total !== null).map((r) => r.line));
    const withoutNumber = new Set(today.filter((r) => r.expected_total === null).map((r) => r.line));
    const keyOf = (l: LineToFreeze) => `${date}|${shift}|${l.line}|${l.forecast.expectedTotal !== null}`;
    const rows = toFreeze
      .filter((l) => l.forecast.jobs.length > 0 && !withNumber.has(l.line) && !saved.current.has(keyOf(l)))
      .filter((l) => l.forecast.expectedTotal !== null || !withoutNumber.has(l.line));
    const payload = rows
      .map((l) => ({
        line: l.line,
        shown: l.shown,
        expected_total: l.forecast.expectedTotal,
        expected_per_hour: l.forecast.expectedPerHour,
        status: l.forecast.status,
        confidence: l.forecast.confidence,
        factor: l.factor?.factor ?? null,
        factor_shifts: l.factor?.shiftsUsed ?? null,
        jobs: l.forecast.jobs.map((j) => ({
          sku: j.sku,
          order: j.orderQty,
          expected: j.expectedContainers,
          basis: j.allocation?.basis ?? null,
          estimated: isEstimateRate(j.rate?.source),
          cleaning: j.cleaning ? { kind: j.cleaning.kind, minutes: j.cleaning.minutes } : null,
        })),
        engine_version: ENGINE_VERSION,
      }));
    if (!rows.length) return;
    rows.forEach((l) => saved.current.add(keyOf(l)));
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("save_smart_target_forecasts", { p_date: date, p_shift: shift, p_rows: payload });
      if (error) rows.forEach((l) => saved.current.delete(keyOf(l)));
      else await qc.invalidateQueries({ queryKey: ["smart_target_forecasts"] });
    })();
  }, [ready, toFreeze, log.data, date, shift, qc]);
}
