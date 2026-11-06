/**
 * How far Smart Target's frozen forecasts were from what was logged (decided 05/11,
 * Q27a–Q30a).
 *
 * Two rules decide what counts:
 *
 * - Only forecasts frozen in the first two hours of their shift (Q29a). A forecast made
 *   at 14:00 already knows half the answer. That is the flaw that made the RAG plan
 *   useless to measure against (431 of 904 written after the shift).
 * - The actual is what operators logged for that line and shift (Q30a), labelled as such.
 *   It is read at view time, never stored next to the forecast, so switching to iTouch
 *   events later re-scores the whole history at once.
 *
 * A forecast without a number (insufficient data) and a shift with nothing logged are
 * listed as not measurable, never scored as a 100% miss.
 */

import { ENGINE_VERSION, shiftWindow, type LineNo, type ShiftType } from "./engine.ts";
import type { HistoryShift } from "./rates.ts";

/** Forecasts frozen later than this after the shift starts are kept but not scored. */
export const ON_TIME_MINUTES = 120;

export interface StoredForecast {
  session_date: string;
  shift: ShiftType;
  line: number;
  shown: boolean;
  expected_total: number | null;
  frozen_at: string;
  /** The method that made it. Only the current method is scored; a missing one counts as current. */
  engine_version?: string | null;
  /** What the forecast was built from; a job marked estimated keeps it out of the main measure. */
  jobs?: { estimated?: boolean }[] | null;
}

export interface LineAccuracy {
  line: LineNo;
  /** Closed shifts with an on-time forecast and a logged actual. */
  scored: number;
  frozenLate: number;
  noNumber: number;
  noActual: number;
  /** Made by an earlier method: kept, listed, not scored, so the error describes the rule in use. */
  oldMethod: number;
  /** Forecasts resting on an estimate: kept, listed, not scored (Q62a). */
  estimated: number;
  medianAbsPctError: number | null;
  within10: number;
  within20: number;
  /** Most recent scored shifts, newest first. */
  recent: { date: string; shift: ShiftType; forecast: number; actual: number; errorPct: number }[];
}

/** Total logged per `${date}|${shift}|${line}`, from the same history the factor reads. */
export function actualTotals(history: HistoryShift[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const h of history) {
    const total = h.made.reduce((s, m) => s + (m.qty > 0 ? m.qty : 0), 0);
    if (total > 0) out.set(h.key, total);
  }
  return out;
}

export function frozenOnTime(f: StoredForecast): boolean {
  const w = shiftWindow(f.session_date, f.shift);
  const t = Date.parse(f.frozen_at);
  if (!w || !Number.isFinite(t)) return false;
  return t - w.startMs <= ON_TIME_MINUTES * 60_000;
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Per line, over the forecasts given. A forecast is scored only once its shift is in
 * `actuals`, so a shift still running is simply not there yet.
 */
export function accuracyByLine(forecasts: StoredForecast[], actuals: Map<string, number>, recentCount = 5): LineAccuracy[] {
  return ([1, 2, 3, 4, 5, 6] as LineNo[]).map((line) => {
    const own = forecasts
      .filter((f) => f.line === line)
      .sort((a, b) => (a.session_date === b.session_date ? (a.shift < b.shift ? 1 : -1) : a.session_date < b.session_date ? 1 : -1));
    const acc: LineAccuracy = { line, scored: 0, frozenLate: 0, noNumber: 0, noActual: 0, oldMethod: 0, estimated: 0, medianAbsPctError: null, within10: 0, within20: 0, recent: [] };
    const errors: number[] = [];
    for (const f of own) {
      if (f.engine_version && f.engine_version !== ENGINE_VERSION) { acc.oldMethod++; continue; }
      if (!frozenOnTime(f)) { acc.frozenLate++; continue; }
      if (f.expected_total === null) { acc.noNumber++; continue; }
      if (f.jobs?.some((j) => j.estimated)) { acc.estimated++; continue; }
      const actual = actuals.get(`${f.session_date}|${f.shift}|${line}`);
      if (!actual) { acc.noActual++; continue; }
      const errorPct = ((f.expected_total - actual) / actual) * 100;
      errors.push(Math.abs(errorPct));
      if (acc.recent.length < recentCount) {
        acc.recent.push({ date: f.session_date, shift: f.shift, forecast: f.expected_total, actual, errorPct: Math.round(errorPct * 10) / 10 });
      }
    }
    acc.scored = errors.length;
    const m = median(errors);
    acc.medianAbsPctError = m === null ? null : Math.round(m * 10) / 10;
    acc.within10 = errors.filter((e) => e <= 10).length;
    acc.within20 = errors.filter((e) => e <= 20).length;
    return acc;
  });
}

/** Shifts a line must have measured before its own record replaces the tested margin. */
export const SHOW_MIN_SCORED = 10;
/** The goal: median absolute miss, in percent, at or under which a line needs no caution. */
export const SHOW_MAX_MEDIAN_ERROR = 15;

export interface LineCaution {
  line: LineNo;
  /** What to tell the reader about a line over the goal; null when it is within it. */
  caution: string | null;
}

/**
 * Which lines' numbers need a caution beside them. Until a line has SHOW_MIN_SCORED measured
 * shifts, the margin from the base's test stands (`tested`). From then on its own record
 * decides, both ways. No line loses its number over this.
 */
export function lineCautions(accuracy: LineAccuracy[] | null, tested: Partial<Record<LineNo, number>>): LineCaution[] {
  return ([1, 2, 3, 4, 5, 6] as LineNo[]).map((line) => {
    const a = accuracy?.find((x) => x.line === line);
    if (!a || a.scored < SHOW_MIN_SCORED || a.medianAbsPctError === null) {
      const miss = tested[line];
      return { line, caution: miss === undefined ? null : `Tested on shifts since 15/09, Line ${line} missed by a median ${miss}%, over the ${SHOW_MAX_MEDIAN_ERROR}% goal. Read its number as a guide (${a?.scored ?? 0} of ${SHOW_MIN_SCORED} shifts measured so far).` };
    }
    return {
      line,
      caution: a.medianAbsPctError <= SHOW_MAX_MEDIAN_ERROR ? null : `Over its last ${a.scored} measured shifts Line ${line} missed by a median ${a.medianAbsPctError}%, over the ${SHOW_MAX_MEDIAN_ERROR}% goal. Read its number as a guide.`,
    };
  });
}

/**
 * What the line card compares: the target kept for the shift, and what was logged against it.
 * The miss is against the kept target when there is one. A number calculated after the shift
 * has seen its plan and proves nothing.
 */
export function targetVersusLogged(kept: number | null | undefined, logged: number | null | undefined): number | null {
  if (kept === null || kept === undefined || !logged || logged <= 0) return null;
  return Math.round(((kept - logged) / logged) * 100);
}
