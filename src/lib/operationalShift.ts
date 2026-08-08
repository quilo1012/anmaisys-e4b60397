/**
 * Which board is running right now, and which day it belongs to.
 *
 * The board opens on `new Date()` and on Day. At three in the morning both are wrong:
 * the calendar has turned over but the night crew is four hours from going home, so
 * the screen shows an empty Day board for a day that has not started while forty-eight
 * people are on the floor. The night supervisor's first act of every shift is to page
 * back a day and switch tab.
 *
 * A night shift dated D runs 18:00 on D to 06:00 on D+1. So between midnight and 06:00
 * the operational date is *yesterday* — the same rule `shiftTimeToIso` already applies
 * to production times, and it has to be the same rule, or a run recorded at 02:00 sits
 * on one date and the board that recorded it on another.
 *
 * The split here is 06:00/18:00, where `productionTime` splits at noon. They answer
 * different questions and both are right: this one asks "what is running", where an
 * exact boundary is the point; that one asks "which day did a typed time mean", and is
 * deliberately generous so a run that overshoots to 06:40 still lands on its own night.
 */

export type ShiftKey = "Day" | "Night";

/** 06:00. Before it the night is still running; from it the day crew is in. */
const DAY_STARTS = 6;
/** 18:00. From it the night crew is in. */
const NIGHT_STARTS = 18;

export interface CurrentShift {
  shift: ShiftKey;
  /** The date the board is filed under — yesterday, in the small hours of a night. */
  operationalDate: string;
  /**
   * True between midnight and 06:00, when the operational date is not today's date.
   * The screen says so, because a board silently showing yesterday is worse than one
   * that shows yesterday and admits it.
   */
  carriedOver: boolean;
}

/**
 * The board that is running at `now`, on the factory's clock.
 *
 * London, not the browser's zone: a laptop left on Lisbon time would put the 06:00
 * handover an hour out and hand the day crew's first hour to the night board.
 */
export function currentShift(now: Date = new Date()): CurrentShift {
  const { year, month, day, hour } = londonParts(now);

  const isNight = hour >= NIGHT_STARTS || hour < DAY_STARTS;
  const carriedOver = isNight && hour < DAY_STARTS;

  // Midnight to 06:00 belongs to the night that started yesterday evening.
  const base = Date.UTC(year, month - 1, day) - (carriedOver ? 86_400_000 : 0);
  return {
    shift: isNight ? "Night" : "Day",
    operationalDate: new Date(base).toISOString().slice(0, 10),
    carriedOver,
  };
}

/** Calendar fields as London reads them at that instant. */
function londonParts(at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    })
      .formatToParts(at)
      .filter((x) => x.type !== "literal")
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  // en-GB renders midnight as hour 24 in some engines.
  return { year: p.year, month: p.month, day: p.day, hour: p.hour === 24 ? 0 : p.hour };
}

/**
 * Day before Night, wherever a list carries both.
 *
 * The Production Control export had no shift term in its sort at all, so within a date
 * and a line the two came out in whatever order Postgres returned them — which read as
 * Night first. There it is the LAST term: the line is the outer grouping, and the sheet
 * follows one line down its two shifts before moving to the next.
 *
 * Unknown shifts sort last rather than throwing: a value the board grows later should
 * not silently jump the queue, and it must never land between the two that matter.
 */
export function shiftRank(shift: string | null | undefined): number {
  const s = (shift ?? "").trim().toUpperCase();
  if (s === "DAY") return 0;
  if (s === "NIGHT") return 1;
  return 2;
}
