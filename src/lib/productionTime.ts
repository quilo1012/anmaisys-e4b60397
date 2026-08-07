/**
 * A typed "HH:mm" onto the day it actually belongs to.
 *
 * It used to be stamped onto whatever day the form happened to be submitted:
 *
 *     const d = new Date(); d.setHours(h, m, 0, 0);
 *
 * On a day shift that is usually right by accident. On nights it is wrong half the
 * time, because the shift crosses midnight and the operator does not. Somebody on the
 * night of 06/08 who logs at 01:00 that a run started at 17:20 gets 07/08 17:20 —
 * eighteen hours AFTER the finish they typed before midnight, which is how a record
 * comes to have a negative duration. Twenty-three of them do.
 *
 * The session knows better than the clock. A NIGHT session dated D runs 18:00 on D to
 * 06:00 on D+1, so an evening time belongs to D and a small-hours time to D+1. A DAY
 * session is all one calendar day.
 */

export type ShiftName = "DAY" | "NIGHT";

/** Where a night shift stops being the evening and starts being the morning. */
const NIGHT_ROLLS_OVER_BEFORE = 12;

/**
 * The instant a typed time refers to, or null when it is not a time.
 *
 * Built in London and returned as UTC, because that is what the column stores and the
 * factory's clocks are on the wall in London whatever the server thinks.
 */
export function shiftTimeToIso(
  hm: string | null | undefined,
  sessionDate: string,
  shift: string | null | undefined,
): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hm ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return null;

  // Midnight to noon on a night shift is the morning after. Noon is the split rather
  // than 06:00 so a run that overshoots the end of the shift still lands on the right
  // day — 06:40 on a night is the same morning, not a fortnight of confusion.
  const isNight = (shift ?? "").toUpperCase() === "NIGHT";
  const dayOffset = isNight && hour < NIGHT_ROLLS_OVER_BEFORE ? 1 : 0;

  const base = Date.parse(`${sessionDate}T00:00:00Z`);
  if (Number.isNaN(base)) return null;
  const asUtcWallClock = base + (dayOffset * 24 + hour) * 3_600_000 + minute * 60_000;

  // London is UTC or UTC+1. Take the offset at that instant and subtract it, so the
  // wall clock the operator typed is what comes back out.
  const offsetMinutes = londonOffsetMinutes(new Date(asUtcWallClock));
  return new Date(asUtcWallClock - offsetMinutes * 60_000).toISOString();
}

function londonOffsetMinutes(at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const asUTC = Date.UTC(
    +p.year, +p.month - 1, +p.day, +p.hour === 24 ? 0 : +p.hour, +p.minute, +p.second,
  );
  return Math.round((asUTC - at.getTime()) / 60_000);
}

/**
 * Minutes a run took, or null when either end is missing.
 *
 * Negative is returned as null rather than as a negative number. A run cannot finish
 * before it starts, and passing the negative on lets it be averaged into a line's
 * speed, where it silently cancels out real minutes.
 */
export function runMinutes(startIso: string | null, finishIso: string | null): number | null {
  if (!startIso || !finishIso) return null;
  const a = Date.parse(startIso), b = Date.parse(finishIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const mins = Math.round((b - a) / 60_000);
  return mins > 0 ? mins : null;
}
