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
