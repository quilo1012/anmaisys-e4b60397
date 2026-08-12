/**
 * Hours somebody was not there for, on a day they came in.
 *
 * `daily_allocations.left_early_at` had been on the board since it was built and nothing
 * ever counted it. Elias Soares came in on 07/08 and went home at 08:00, two hours into an
 * eleven-hour shift, and every screen recorded a full day: the headcount counted him
 * present, the attendance record said "present", the shift balance counted one shift
 * worked. Nine hours he was not paid for and nobody was short, because no number anywhere
 * was hours.
 *
 * `arrived_late_at` is the same fact from the other end, and the board could not say it at
 * all. Somebody due at six who walked in at nine was stored exactly like somebody who was
 * there at six.
 *
 * A day cut short at either end is not a day off, which is why neither is `half_day` and
 * neither is `unpaid` as a status — the person was on the line for the part between them
 * and the supervisor needs to see them there. It is a day worked in part, and the part not
 * worked is the unpaid part.
 *
 * Both can be true at once — in at nine, home at two — so this takes the window between
 * them rather than two separate shortfalls added up. Added up, the break would be deducted
 * twice, or deducted from a morning that never contained one.
 *
 * THE BREAK IS AN ASSUMPTION, and a stated one. The rota records how long the break is and
 * never when it falls, so this deducts it only from somebody whose window covers the middle
 * of the shift, on the reasoning that a break sits somewhere near the middle. Anybody who
 * left before that, or arrived after it, never took one. It is wrong by at most the length
 * of the break, always in the direction of crediting the person with the hours, and the
 * alternative — deducting an hour nobody took — charges them for lunch they did not have.
 */

export interface ShiftHours {
  /** "HH:MM:SS" or "HH:MM", as `shift_patterns` stores them. */
  startsAt: string | null | undefined;
  endsAt: string | null | undefined;
  breakMinutes: number | null | undefined;
}

/** What the board recorded about the two ends of one person's day. */
export interface DayMarks {
  /** `"HH:MM"` if they came in after the shift had started, null if they were on time. */
  arrivedLateAt?: string | null;
  /** `"HH:MM"` if they went home before the shift ended, null if they worked it out. */
  leftEarlyAt?: string | null;
}

export interface PartDay {
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
 * What a day cut short cost, or null when there is not enough to work it out.
 *
 * Null rather than a guess: without a rota there is no shift length to measure the
 * shortfall against, and reporting "0 hours missed" for somebody who went home at eight
 * would be worse than reporting nothing. Null too when neither end of the day is marked —
 * a whole day worked is not a part day and this has nothing to say about it.
 */
export function partDay(marks: DayMarks, shift: ShiftHours): PartDay | null {
  const hasLate = (marks.arrivedLateAt ?? null) !== null && marks.arrivedLateAt !== "";
  const hasEarly = (marks.leftEarlyAt ?? null) !== null && marks.leftEarlyAt !== "";
  if (!hasLate && !hasEarly) return null;

  const start = minutes(shift.startsAt);
  const end = minutes(shift.endsAt);
  if (start == null || end == null) return null;

  // A night shift ends the next morning, so its end reads as smaller than its start.
  const span = end > start ? end - start : end + 1440 - start;
  const brk = Math.max(0, shift.breakMinutes ?? 0);
  const shiftMinutes = span - brk;
  if (shiftMinutes <= 0) return null;

  // Both times are measured as minutes into the shift, with the same wrap: somebody on
  // nights who goes home at 02:00 left eight hours in, not sixteen hours before they
  // arrived. Unmarked ends sit at the shift's own — in on time, out at the end.
  const offset = (hm: string | null | undefined): number | null => {
    const t = minutes(hm);
    if (t == null) return null;
    const into = t >= start ? t - start : t + 1440 - start;
    return into >= 0 && into <= span ? into : null;
  };

  const arrived = hasLate ? offset(marks.arrivedLateAt) : 0;
  const left = hasEarly ? offset(marks.leftEarlyAt) : span;
  if (arrived == null || left == null) return null;
  // A day that ends before it starts means one of the two times is wrong, and guessing
  // which would put a negative day into payroll.
  if (left < arrived) return null;

  // See the note above: the break is only deducted from somebody whose window covers the
  // middle of the shift, which is the only place the rota lets us suppose it falls.
  const middle = span / 2;
  const tookBreak = arrived < middle && left > middle;
  const present = left - arrived;
  const worked = Math.max(0, present - (tookBreak ? brk : 0));

  return {
    workedHours: round2(worked / 60),
    missedHours: round2(Math.max(0, shiftMinutes - worked) / 60),
    shiftHours: round2(shiftMinutes / 60),
  };
}
