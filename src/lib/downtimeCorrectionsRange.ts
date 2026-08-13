/**
 * "Does this correction belong to this range and this line?"
 *
 * A correction is filed under the STOPPAGE it changed, not under the day someone
 * typed it: the Corrections section sits beneath numbers for a set of days and has
 * to explain those numbers, so a Monday stoppage corrected on Friday is a Monday row.
 *
 * Line matching mirrors the rest of the page — the live line name when the order
 * still points at a line, the `line_at_time` snapshot when it does not.
 */

export interface CorrectionRowLike {
  /** Current start of the stoppage (from downtime_events), ISO. */
  stopped_at?: string | null;
  /** Start recorded on the correction itself — used if the event is gone. */
  new_stopped_at?: string | null;
  /** Live line name via work_orders → lines. */
  line_name?: string | null;
  /** Snapshot line on the work order. */
  line_at_time?: string | null;
}

/** The line label a correction row should be filtered and displayed by. */
export function correctionLineLabel(r: CorrectionRowLike): string {
  const live = (r.line_name ?? "").toString().trim();
  if (live) return live;
  const snap = (r.line_at_time ?? "").toString().trim();
  if (snap && !/^removed$/i.test(snap)) return snap;
  return "—";
}

/** The moment the corrected stoppage started, in ms, or null when unknown. */
export function correctionStoppageMs(r: CorrectionRowLike): number | null {
  const raw = r.stopped_at ?? r.new_stopped_at ?? null;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

export function correctionInRange(
  r: CorrectionRowLike,
  fromMs: number,
  toMs: number,
  lineFilter: string = "all",
): boolean {
  const ms = correctionStoppageMs(r);
  if (ms === null) return false;
  if (ms < fromMs || ms > toMs) return false;
  if (lineFilter && lineFilter !== "all" && correctionLineLabel(r) !== lineFilter) return false;
  return true;
}
