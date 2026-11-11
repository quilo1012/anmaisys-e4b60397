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
  jobs?: { sku?: string | null; estimated?: boolean; expected?: number | null }[] | null;
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
  /** Shifts whose line closed before half way: the engine cannot know that, so not scored (Q79). */
  endedEarly: number;
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

type NotScored = "oldMethod" | "frozenLate" | "noNumber" | "estimated" | "endedEarly" | "noActual";

/** Why a kept forecast is not measured, or null when it is. */
export function notScored(f: StoredForecast, actuals: Map<string, number>, endedEarly: ReadonlySet<string> = new Set()): NotScored | null {
  const key = `${f.session_date}|${f.shift}|${f.line}`;
  if (f.engine_version && f.engine_version !== ENGINE_VERSION) return "oldMethod";
  if (!frozenOnTime(f)) return "frozenLate";
  if (f.expected_total === null) return "noNumber";
  // Only a job that adds to the number can make it an estimate. What iTouch queued past
  // the shift sits in the row with 0 expected, and on 09/11 kept Line 2's day out of the
  // measure although its whole 6,666 came from COL165SR's own history. A row saved before
  // jobs carried their number still counts every estimated job.
  if (f.jobs?.some((j) => j.estimated && (typeof j.expected !== "number" || j.expected > 0))) return "estimated";
  if (endedEarly.has(key)) return "endedEarly";
  if (!actuals.get(key)) return "noActual";
  return null;
}

/**
 * The RAG plan as it stood when the shift started (decided 11/11, Q88), or null when it was
 * written after: 431 of 904 plans were, and a plan written knowing the answer is no forecast.
 * A plan changed during the shift is taken at its value before the first change.
 */
export function planAtStart(
  entry: { plan_qty: number | null; created_at: string },
  changes: { changed_at: string; before_qty: number | null; kind: string }[],
  startMs: number,
): number | null {
  if (!(Date.parse(entry.created_at) <= startMs)) return null;
  const after = changes
    .filter((c) => c.kind === "line" && Date.parse(c.changed_at) > startMs)
    .sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at))[0];
  const value = after ? after.before_qty : entry.plan_qty;
  return value !== null && value > 0 ? value : null;
}

export interface VersusPlan {
  line: LineNo;
  /** Measured shifts that also had a plan written before they started. */
  shifts: number;
  smartMedian: number | null;
  planMedian: number | null;
}

/** Smart Target against the RAG plan, on the same shifts and with the same actual (Q88). */
export function versusPlan(
  forecasts: StoredForecast[],
  actuals: Map<string, number>,
  plans: Map<string, number>,
  endedEarly: ReadonlySet<string> = new Set(),
): VersusPlan[] {
  return ([1, 2, 3, 4, 5, 6] as LineNo[]).map((line) => {
    const smart: number[] = [];
    const plan: number[] = [];
    for (const f of forecasts) {
      if (f.line !== line || notScored(f, actuals, endedEarly)) continue;
      const key = `${f.session_date}|${f.shift}|${line}`;
      const p = plans.get(key);
      if (p === undefined) continue;
      const actual = actuals.get(key)!;
      smart.push(Math.abs(((f.expected_total! - actual) / actual) * 100));
      plan.push(Math.abs(((p - actual) / actual) * 100));
    }
    const r = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
    return { line, shifts: smart.length, smartMedian: r(median(smart)), planMedian: r(median(plan)) };
  });
}

/**
 * Per line, over the forecasts given. A forecast is scored only once its shift is in
 * `actuals`, so a shift still running is simply not there yet.
 */
export function accuracyByLine(
  forecasts: StoredForecast[],
  actuals: Map<string, number>,
  recentCount = 5,
  /** `${date}|${shift}|${line}` of shifts that closed before half way. */
  endedEarly: ReadonlySet<string> = new Set(),
): LineAccuracy[] {
  return ([1, 2, 3, 4, 5, 6] as LineNo[]).map((line) => {
    const own = forecasts
      .filter((f) => f.line === line)
      .sort((a, b) => (a.session_date === b.session_date ? (a.shift < b.shift ? 1 : -1) : a.session_date < b.session_date ? 1 : -1));
    const acc: LineAccuracy = { line, scored: 0, frozenLate: 0, noNumber: 0, noActual: 0, oldMethod: 0, estimated: 0, endedEarly: 0, medianAbsPctError: null, within10: 0, within20: 0, recent: [] };
    const errors: number[] = [];
    for (const f of own) {
      const why = notScored(f, actuals, endedEarly);
      if (why) { acc[why]++; continue; }
      const actual = actuals.get(`${f.session_date}|${f.shift}|${line}`)!;
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
