import {
  endOfMonth, endOfQuarter, endOfWeek, endOfYear,
  format, parseISO,
  startOfMonth, startOfQuarter, startOfWeek, startOfYear,
} from "date-fns";

/**
 * What Production Performance is looking at, and where that answer lives.
 *
 * It used to live in six `useState` calls seeded from `getCurrentFactoryShift()`. That
 * is invisible until you leave: open a leader's scorecard — which has its own address,
 * on purpose, see scorecardRoute.ts — and press Back, and the plate comes up on today,
 * on the shift running right now, on All leaders. Everything you set to get there is
 * gone, and nothing says so, so the natural reading is that the screen reset itself
 * rather than that the period moved. A person comparing two leaders over September
 * does that walk once per leader.
 *
 * In the address the Back button restores it, the period can be linked to whoever is
 * being asked about it, and a printed sheet can be got back to. The same three reasons
 * the scorecard was made a route.
 */

export type PerfPeriod = "day" | "week" | "month" | "quarter" | "year" | "custom";
export type PerfShift = "all" | "DAY" | "NIGHT";

/** Line and leader both use this for "no filter" — it is the Select's own value. */
export const PERF_ALL = "__all__";

const PERIODS: readonly PerfPeriod[] = ["day", "week", "month", "quarter", "year", "custom"];

export interface PerfFilters {
  /** The anchor day. For every period but `custom` it is the only date that matters. */
  date: string;
  /** The far end, and ONLY read when `period` is `custom`. */
  endDate: string;
  period: PerfPeriod;
  shift: PerfShift;
  line: string;
  leader: string;
}

/**
 * `YYYY-MM-DD`, and a real day — `2026-02-31` parses in JS and is not a date.
 *
 * Built at UTC midnight for the reason scorecardRoute.ts gives at length:
 * `new Date("2026-08-01T00:00:00")` is LOCAL midnight, which in London under BST is
 * 23:00 on 31 July, so a round-trip through `toISOString()` rejects every valid date
 * by one day.
 */
function isIsoDate(v: string | null | undefined): v is string {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Read the address back, with a defensible answer for every way it can be wrong.
 *
 * `defaults` is passed in rather than read from the clock so this stays pure — and so
 * the caller decides what "now" means, which on this screen is the factory's shift and
 * not the browser's midnight.
 */
export function parsePerfFilters(
  search: URLSearchParams,
  defaults: { date: string; shift: PerfShift },
): PerfFilters {
  const rawPeriod = (search.get("period") ?? "").trim().toLowerCase() as PerfPeriod;
  const period = PERIODS.includes(rawPeriod) ? rawPeriod : "day";

  const rawFrom = search.get("from");
  const date = isIsoDate(rawFrom) ? rawFrom : defaults.date;

  // Outside `custom` the far end is derived, so a stale or absent `to` must not be able
  // to narrow anything: it collapses onto the anchor, which is what every calendar
  // period already does with it.
  const rawTo = search.get("to");
  let endDate = period === "custom" && isIsoDate(rawTo) ? rawTo : date;
  // Hand-edited backwards. Swapping beats an empty board that reads as a quiet day.
  let from = date;
  if (from > endDate) [from, endDate] = [endDate, from];

  const rawShift = (search.get("shift") ?? "").trim().toUpperCase();
  const shift: PerfShift =
    rawShift === "DAY" || rawShift === "NIGHT" ? rawShift
    : rawShift === "ALL" ? "all"
    : defaults.shift;

  return {
    date: from,
    endDate,
    period,
    shift,
    line: search.get("line")?.trim() || PERF_ALL,
    leader: search.get("leader")?.trim() || PERF_ALL,
  };
}

/**
 * The address for a set of filters, with the defaults left out.
 *
 * Omitting them keeps the link short, and means an address that carries no shift
 * cannot be read as a shift having been chosen — the distinction scorecardLinkPeriod
 * was written for. `to` is only ever written for `custom`, so a link can never imply
 * a far end that the period does not use.
 */
export function perfFiltersToParams(f: PerfFilters, defaults: { date: string; shift: PerfShift }): URLSearchParams {
  const q = new URLSearchParams();
  if (f.date !== defaults.date) q.set("from", f.date);
  if (f.period !== "day") q.set("period", f.period);
  if (f.period === "custom" && f.endDate !== f.date) q.set("to", f.endDate);
  if (f.shift !== defaults.shift) q.set("shift", f.shift === "all" ? "ALL" : f.shift);
  if (f.line !== PERF_ALL) q.set("line", f.line);
  if (f.leader !== PERF_ALL) q.set("leader", f.leader);
  return q;
}

/**
 * The days the board actually covers.
 *
 * Lifted out of the page because it is the arithmetic a month of readings was argued
 * about. `Period` is not a label on the dates — it OWNS them, and outside `custom` the
 * second box is derived and was being drawn from a state nobody had updated.
 */
export function resolvePerfRange(f: Pick<PerfFilters, "date" | "endDate" | "period">): { from: string; to: string } {
  const d = parseISO(f.date);
  const iso = (x: Date) => format(x, "yyyy-MM-dd");
  switch (f.period) {
    case "day": return { from: f.date, to: f.date };
    case "week": return { from: iso(startOfWeek(d, { weekStartsOn: 1 })), to: iso(endOfWeek(d, { weekStartsOn: 1 })) };
    case "month": return { from: iso(startOfMonth(d)), to: iso(endOfMonth(d)) };
    case "quarter": return { from: iso(startOfQuarter(d)), to: iso(endOfQuarter(d)) };
    case "year": return { from: iso(startOfYear(d)), to: iso(endOfYear(d)) };
    default: return f.date <= f.endDate ? { from: f.date, to: f.endDate } : { from: f.endDate, to: f.date };
  }
}

/**
 * What typing a new "From" means, and the defect it closes.
 *
 * It used to mean "throw the period away": any change to the box set `period` to
 * `custom` and left the far end wherever it had been, which was today. So moving From
 * to 01/09 did not ask for September — it asked for 01/09 up to and including today,
 * five weeks of it, and the only thing on the plate that could have said so was a
 * second date box that calendar periods never updated. A night action from 03/10
 * answered a question somebody believed was about September. Twice, from two ends:
 * once as "the scorecard is counting October", once as "the filter resets on Back".
 *
 * A period is a shape and the anchor is where you put it. So From RE-ANCHORS: Month
 * stays Month and moves to that month, Day stays Day. It is what the ← → arrows beside
 * the boxes have always done, and typing a date now agrees with them.
 *
 * `custom` is the one period where the two boxes are genuinely independent ends, and
 * there the far end is only pushed when the near one has overtaken it.
 */
export function withAnchor(f: PerfFilters, date: string): PerfFilters {
  if (f.period !== "custom") return { ...f, date, endDate: date };
  return { ...f, date, endDate: f.endDate < date ? date : f.endDate };
}

/**
 * Typing into the far box is a request for two independent ends — which is `custom`,
 * whatever the Period select said a moment ago.
 */
export function withFarEnd(f: PerfFilters, endDate: string): PerfFilters {
  return { ...f, period: "custom", endDate, date: f.date > endDate ? endDate : f.date };
}

/** Changing the period keeps the anchor and re-derives the far end from it. */
export function withPeriod(f: PerfFilters, period: PerfPeriod): PerfFilters {
  if (period !== "custom") return { ...f, period, endDate: f.date };
  return { ...f, period, endDate: f.endDate < f.date ? f.date : f.endDate };
}
