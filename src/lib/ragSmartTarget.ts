/**
 * The Smart Target on the RAG Weekly board (decided 07/11, Q71–Q76).
 *
 * One read-only row under Plan, with the number kept before the shift, and one row comparing
 * what was made with it. Only Lines 1–6 have a Smart Target. A total adds up the shifts that
 * have a number and says when one that ran has none, so a part never passes for the whole.
 */
import { FORECAST_LINES } from "@/lib/smartTargetHistory";
import { shiftWindow } from "@/lib/smartTargetEngine";

export type RagShift = "DAY" | "NIGHT";

export interface RagSmartForecast {
  expected: number;
  setAt: string;
  /** "ahead": made by the server before the shift; "page": saved from the Smart Target page. */
  source: string | null;
}

/** Keyed like the board's cells: `date|Line N|SHIFT`. */
export type RagSmartMap = Map<string, RagSmartForecast>;

export const ragSmartKey = (date: string, line: string, shift: RagShift) => `${date}|${line}|${shift}`;

const SMART_LINES = new Set(FORECAST_LINES.map((n) => `line ${n}`));
export const hasSmartTarget = (line: string) => SMART_LINES.has(line.trim().toLowerCase());

/** What a cell, or a sum of cells, knows about the Smart Target. */
export interface SmartTally {
  /** Sum of the Smart Targets that exist. */
  smart: number;
  /** The Smart Targets of the shifts that have started: a shift still to come has nothing to compare. */
  comparedSmart: number;
  /** What was made on those shifts, so the comparison is like for like. */
  actual: number;
  withNumber: number;
  /** Shifts that ran, with a plan or a count, and had no Smart Target. */
  missing: number;
}

export const NO_SMART: SmartTally = { smart: 0, comparedSmart: 0, actual: 0, withNumber: 0, missing: 0 };

/** One line, one shift. A shift that has not started shows its Smart Target and is not compared. */
export function smartTally(
  map: RagSmartMap | undefined,
  date: string,
  line: string,
  shift: RagShift,
  plan: number,
  actual: number,
  nowMs: number = Date.now(),
): SmartTally {
  if (!map || !hasSmartTarget(line)) return NO_SMART;
  const f = map.get(ragSmartKey(date, line, shift));
  if (f) {
    const window = shiftWindow(date, shift);
    const started = actual > 0 || (window !== null && nowMs >= window.startMs);
    return started ? { smart: f.expected, comparedSmart: f.expected, actual, withNumber: 1, missing: 0 } : { ...NO_SMART, smart: f.expected, withNumber: 1 };
  }
  return plan > 0 || actual > 0 ? { ...NO_SMART, missing: 1 } : NO_SMART;
}

export function addTallies(tallies: SmartTally[]): SmartTally {
  return tallies.reduce(
    (sum, t) => ({
      smart: sum.smart + t.smart,
      comparedSmart: sum.comparedSmart + t.comparedSmart,
      actual: sum.actual + t.actual,
      withNumber: sum.withNumber + t.withNumber,
      missing: sum.missing + t.missing,
    }),
    NO_SMART,
  );
}

/** Made against Smart Target, in whole percent. Null with nothing to compare. */
export function smartVariancePct(t: SmartTally): number | null {
  if (t.comparedSmart <= 0) return null;
  return Math.round(((t.actual - t.comparedSmart) / t.comparedSmart) * 100);
}

/** "3 of 4 shifts", for a total that is missing some, or null when it is whole. */
export function smartCoverage(t: SmartTally): string | null {
  if (!t.missing) return null;
  const all = t.withNumber + t.missing;
  return `${t.withNumber} of ${all} shift${all === 1 ? "" : "s"} that ran had a Smart Target`;
}

const londonHm = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/** The hover text of one shift's Smart Target: when and how it was made. */
export function smartOrigin(f: RagSmartForecast): string {
  const how = f.source === "ahead" ? "made before the shift from the iTouch queue" : "saved from the Smart Target page";
  return `Set ${londonHm(f.setAt)}, ${how}.`;
}

/** Rows for the export: one per line and shift with a Smart Target or that ran without one. */
export function smartExportRows(
  map: RagSmartMap,
  cells: { date: string; line: string; shift: RagShift; plan: number; actual: number }[],
  nowMs: number = Date.now(),
) {
  return cells
    .map((c) => ({ c, t: smartTally(map, c.date, c.line, c.shift, c.plan, c.actual, nowMs), f: map.get(ragSmartKey(c.date, c.line, c.shift)) }))
    .filter(({ t }) => t.withNumber || t.missing)
    .map(({ c, t, f }) => ({
      Date: c.date,
      Line: c.line,
      Shift: c.shift === "DAY" ? "Day" : "Night",
      Plan: c.plan || null,
      "Smart Target": f ? f.expected : null,
      Actual: c.actual || null,
      "Smart variance %": smartVariancePct(t),
      "Set at": f ? londonHm(f.setAt) : null,
    }));
}
