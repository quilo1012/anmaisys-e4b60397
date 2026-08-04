import { worksOn } from "@/hooks/useWorkforce";

/**
 * How long a stretch of leave actually is.
 *
 * Not the number of days on the calendar. Most of this crew works Mon–Thu, so a week
 * off is four days, not seven, and counting calendar days would spend three days of
 * somebody's entitlement on days they were never due in.
 *
 * Counted against the same `worksOn` rule the board and the rota use, so a person's
 * leave and their roster cannot disagree about which days they work.
 */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  // A backwards range is an empty range, not a crash and not every day in between.
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime()) || d > end) return out;
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export interface LeaveDays {
  /** Dates the person was due in, which is what leave is spent on. */
  workingDates: string[];
  /** Null when no rota is on file — a question for a human, never a silent zero. */
  workingDays: number | null;
  calendarDays: number;
}

export function leaveDays(from: string, to: string, patternDays: number[] | null | undefined): LeaveDays {
  const all = eachDate(from, to);
  // No pattern is not the same as a pattern that never works. One is missing
  // information; the other is a fact. Returning 0 for both would let a request be
  // approved for nothing and nobody would know which it was.
  if (!patternDays?.length) return { workingDates: [], workingDays: null, calendarDays: all.length };

  const workingDates = all.filter((iso) => worksOn(patternDays, new Date(`${iso}T12:00:00`)));
  return { workingDates, workingDays: workingDates.length, calendarDays: all.length };
}

/** `4 days` / `1 day` / `rota not recorded`. */
export function describeLeaveDays(d: LeaveDays): string {
  if (d.workingDays == null) return "rota not recorded";
  if (d.workingDays === 0) return "no working days in this range";
  return `${d.workingDays} day${d.workingDays === 1 ? "" : "s"}`;
}

/** The leave year runs 1 August to 31 July, as BrightPay has it. */
export const LEAVE_YEAR_START_MMDD = "08-01";

/** The leave year a date falls in, as `{ from, to }` ISO dates. */
export function leaveYearOf(isoDate: string): { from: string; to: string } {
  const y = Number(isoDate.slice(0, 4));
  const startsThisYear = isoDate.slice(5) >= LEAVE_YEAR_START_MMDD;
  const from = `${startsThisYear ? y : y - 1}-${LEAVE_YEAR_START_MMDD}`;
  const to = `${startsThisYear ? y + 1 : y}-07-31`;
  return { from, to };
}

export interface LeaveBalance {
  /** Approved holiday already behind them. */
  taken: number;
  /** Approved holiday still to come, or running now. */
  booked: number;
  /** Entitlement less both. Null when no entitlement is on file. */
  remaining: number | null;
  /** From the shift pattern. Null for the patterns BrightPay has not given yet. */
  total: number | null;
}

/**
 * What somebody has left, against their own pattern's entitlement.
 *
 * The entitlement is not 28 days for everybody: it is counted in working days of
 * their own rota, so a Mon–Thu person gets 22.5 and a Tue–Fri person 21.5. Counting
 * a fixed number for everybody would hand the Tue–Fri crew a day they do not have.
 *
 * Taken and booked are split on today rather than merged, because they answer
 * different questions — one is spent, the other is promised — and BrightPay reports
 * them apart.
 */
export function leaveBalance(
  /**
   * One entry per day off actually recorded, not per request.
   *
   * Counting requests and counting recorded days give different answers the moment
   * somebody is marked off on the board without paperwork: Anderson Cavalcante had a
   * three-day request and four holidays on the record, so this screen said 3 and the
   * finance close said 4. Both were true about different questions, which is worse
   * than one of them being wrong.
   *
   * The days are what is spent, so the days are what is counted. `amount` carries the
   * half-days the sheet books.
   */
  daysOff: { date: string; amount?: number }[],
  entitlement: number | null,
  today: string,
): LeaveBalance {
  const year = leaveYearOf(today);
  let taken = 0;
  let booked = 0;
  for (const d of daysOff) {
    if (d.date < year.from || d.date > year.to) continue;
    const amount = d.amount ?? 1;
    if (d.date < today) taken += amount;
    else booked += amount;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    taken: round(taken),
    booked: round(booked),
    total: entitlement,
    remaining: entitlement == null ? null : round(entitlement - taken - booked),
  };
}
