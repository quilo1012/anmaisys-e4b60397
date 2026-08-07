/**
 * Hours somebody was not there for, on a day they came in.
 *
 * `daily_allocations.left_early_at` has been on the board since it was built and
 * nothing has ever counted it. Elias Soares came in on 07/08 and went home at 08:00,
 * two hours into an eleven-hour shift, and every screen recorded a full day: the
 * headcount counted him present, the attendance record said "present", the shift
 * balance counted one shift worked. Nine hours he was not paid for and nobody was
 * short, because no number anywhere was hours.
 *
 * A day cut short is not a day off, which is why it is not `half_day` and not `unpaid`
 * as a status — he was on the line all morning and the supervisor needs to see him
 * there. It is a day worked in part, and the part not worked is the unpaid part.
 *
 * THE BREAK IS AN ASSUMPTION, and a stated one. The rota records how long the break is
 * and never when it falls, so this deducts it only when somebody stayed past the middle
 * of the shift, on the reasoning that a break sits somewhere near the middle. Anybody
 * who left before that never took one. It is wrong by at most the length of the break,
 * always in the direction of crediting the person with the hours, and the alternative —
 * deducting an hour nobody took — charges them for lunch they did not have.
 */

export interface ShiftHours {
  /** "HH:MM:SS" or "HH:MM", as `shift_patterns` stores them. */
  startsAt: string | null | undefined;
  endsAt: string | null | undefined;
  breakMinutes: number | null | undefined;
}

export interface EarlyLeave {
  /** Hours actually worked, break already taken off. */
  workedHours: number;
  /** Hours of the rostered shift they were not there for. This is the unpaid part. */
  missedHours: number;
  /** What the whole shift would have paid. */
  shiftHours: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Minutes past midnight, or null when it is not a time. */
function minutes(hm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((hm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * What a day cut short cost, or null when the rota does not say enough to work it out.
 *
 * Null rather than a guess: without a rota there is no shift length to measure the
 * shortfall against, and reporting "0 hours missed" for somebody who went home at eight
 * would be worse than reporting nothing.
 */
export function earlyLeave(
  leftEarlyAt: string | null | undefined,
  shift: ShiftHours,
): EarlyLeave | null {
  const left = minutes(leftEarlyAt);
  const start = minutes(shift.startsAt);
  const end = minutes(shift.endsAt);
  if (left == null || start == null || end == null) return null;

  // A night shift ends the next morning, so its end reads as smaller than its start.
  const span = end > start ? end - start : end + 1440 - start;
  const brk = Math.max(0, shift.breakMinutes ?? 0);
  const shiftMinutes = span - brk;
  if (shiftMinutes <= 0) return null;

  // Same wrap for the leaving time: somebody on nights who goes home at 02:00 left
  // eight hours in, not sixteen hours before they arrived.
  const present = left >= start ? left - start : left + 1440 - start;
  if (present < 0 || present > span) return null;

  // See the note above: the break is only deducted from somebody who was still there
  // when it would have fallen.
  const tookBreak = present > span / 2;
  const worked = Math.max(0, present - (tookBreak ? brk : 0));

  return {
    workedHours: round2(worked / 60),
    missedHours: round2(Math.max(0, shiftMinutes - worked) / 60),
    shiftHours: round2(shiftMinutes / 60),
  };
}
