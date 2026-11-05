/**
 * Each line's performance factor, recalculated from the shifts before the one being
 * forecast (decided 05/11, Q25).
 *
 * The page reads the last eight weeks of closed shifts, quantities only, and turns
 * them into the HistoryShift shape lineFactors() takes. Only shifts strictly before
 * the forecast date are used, so a forecast never learns from the shift it predicts.
 *
 * Which lines may SHOW a number is a separate, human decision. The factor is
 * computed for all six lines. On 05/11 only Lines 2, 4 and 5 forecast October within
 * about 12% using a factor learnt on August and September. Lines 1, 3 and 6 were off
 * by 19–25%. Those three stay at "—", with that reason, until Production sets the
 * error it accepts.
 */

import { forecastShift, parseLineNo, shiftWindow, type LineNo, type ShiftType } from "./smartTargetEngine";
import { identifyItemSku, type SkuCatalogue } from "./lineSku";
import { setupMinutes, type SmartTargetSession } from "./smartTargetInput";
import type { HistoryShift } from "./smartTargetRates";

/** How far back the factor looks. */
export const FACTOR_WINDOW_DAYS = 56;

/** Lines whose forecast is shown. The rest compute a factor but show "—". */
export const FORECAST_LINES: readonly LineNo[] = [2, 4, 5];

/** Why a line is held back, measured 05/11/2026 (factor from Aug–Sep, tested on Oct–4 Nov). */
export const HELD_BACK_REASON: Partial<Record<LineNo, string>> = {
  1: "Line 1 varies too much from shift to shift: forecasting October missed by a median 25%. Shown once Production sets the error it accepts.",
  3: "Line 3 varies too much from shift to shift: forecasting October missed by a median 21%. Shown once Production sets the error it accepts.",
  6: "Line 6 varies too much from shift to shift: forecasting October missed by a median 19%. Shown once Production sets the error it accepts.",
};

/** The first and last session dates the factor reads for a forecast on `date`. */
export function factorWindow(date: string): { from: string; to: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const from = new Date(d.getTime() - FACTOR_WINDOW_DAYS * 86_400_000);
  const to = new Date(d.getTime() - 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export interface HistoryItem {
  session_id: string;
  display_order: number;
  sku_id: string | null;
  sku_code_text: string | null;
  actual_qty: number | null;
}

/**
 * One HistoryShift per line, date and shift (every session of that shift together).
 * Setup minutes come from the engine itself, run on the shift's SKUs in logged order
 * with no rates, so the factor charges exactly the changeovers and mixing the
 * forecast will charge.
 */
export function historyFromSessions(
  sessions: SmartTargetSession[],
  items: HistoryItem[],
  catalogue: SkuCatalogue,
): HistoryShift[] {
  const groups = new Map<string, { line: LineNo; date: string; shift: ShiftType; ids: Set<string> }>();
  for (const s of sessions) {
    const line = parseLineNo(s.line);
    const shift = String(s.shift).trim().toUpperCase();
    if (line === null || (shift !== "DAY" && shift !== "NIGHT")) continue;
    const key = `${s.session_date}|${shift}|${line}`;
    const g = groups.get(key) ?? { line, date: s.session_date, shift: shift as ShiftType, ids: new Set<string>() };
    g.ids.add(s.id);
    groups.set(key, g);
  }

  const out: HistoryShift[] = [];
  for (const [key, g] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const own = items
      .filter((i) => g.ids.has(i.session_id))
      .sort((a, b) => a.display_order - b.display_order || (a.session_id < b.session_id ? -1 : 1));
    const made = new Map<string | null, number>();
    const order: string[] = [];
    for (const i of own) {
      const sku = identifyItemSku(
        { sku_id: i.sku_id, sku_code_text: i.sku_code_text, actual: 0, started_at: null, finished_at: null },
        catalogue,
      )?.code ?? null;
      const qty = Number(i.actual_qty);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      made.set(sku, (made.get(sku) ?? 0) + qty);
      if (sku && !order.includes(sku)) order.push(sku);
    }
    const window = shiftWindow(g.date, g.shift);
    const engine = forecastShift({
      date: g.date,
      shift: g.shift,
      line: g.line,
      jobs: order.map((sku, n) => ({ jobId: `${key}|${n}`, sku, sequence: n + 1 })),
      rates: [],
    });
    out.push({
      key,
      line: g.line,
      made: [...made.entries()].map(([sku, qty]) => ({ sku, qty })),
      netMinutes: (window?.grossMinutes ?? 720) - 75,
      setupMinutes: setupMinutes(engine),
    });
  }
  return out;
}
