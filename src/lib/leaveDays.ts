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

/**
 * The longest leave anybody books in one go, in calendar days.
 *
 * Not a policy — a typo guard. `2126-08-01` for `2026-08-01` is one keystroke, and it
 * is the keystroke that turns a booking into 36,500 iterations and some 26,000 upserts,
 * written straight to the board as approved, with nothing to undo them with.
 */
export const MAX_LEAVE_CALENDAR_DAYS = 366;

/**
 * Why this range cannot be booked, or null when it can.
 *
 * Pulled out of the screen because the screen was not asking. `create()` guarded only
 * the three fields being filled in, and `leaveDays` answers for a backwards range the
 * same way it answers for a real one — with an object — so the guard passed, the
 * request was inserted as APPROVED, `applyToRecords` wrote nothing because there were
 * no working dates, and the toast said "Booked and written to the board". Three
 * different ways of booking nothing, all of them reported as success:
 *
 *   - end before start
 *   - a Mon–Thu person taking only the Saturday
 *   - somebody with no rota on file at all
 *
 * The third is not the same as the other two and does not get the same sentence: it is
 * a missing fact about the person, not a mistake in the dates.
 */
export function leaveRangeProblem(
  from: string,
  to: string,
  days: LeaveDays | null | undefined,
): string | null {
  if (!from || !to) return "Choose a first and last day.";
  if (to < from) return "The last day is before the first — check the dates.";

  const span = eachDate(from, to).length;
  if (span > MAX_LEAVE_CALENDAR_DAYS) {
    // The year is named because that is where the typo always is.
    return `That is ${span.toLocaleString("en-GB")} days. Leave is booked a stretch at a time — check the year on both dates.`;
  }

  if (!days) return "Choose somebody and the days they are taking.";
  if (days.workingDays === null) {
    return "No rota is on file for this person, so there is no way to tell which of these days they were due in. Set their shift pattern first.";
  }
  if (days.workingDays === 0) {
    return "This person was not due in on any of these days, so there is no leave to book.";
  }
  return null;
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

/**
 * Spells of absence, not days of it.
 *
 * Five days in one go is one illness. Five single days scattered across the year is
 * the pattern an absence policy is written to catch, and a day count cannot tell the
 * two apart — both read "5". Consecutive dates are one spell; a gap of a day or more
 * starts another.
 *
 * The gap is measured in calendar days on purpose. Somebody off Thursday and back on
 * the following Monday has two spells by this count even though they missed no
 * scheduled day between, which overstates it for a four-day rota — but the opposite
 * rule needs each person's own rota to decide what "consecutive" means, and getting
 * that wrong the other way would merge two illnesses into one and hide the pattern.
 */
export function countSpells(dates: string[]): number {
  const sorted = [...new Set(dates)].sort();
  let spells = 0;
  let previous: number | null = null;
  for (const date of sorted) {
    const at = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(at)) continue;
    if (previous == null || at - previous > 86_400_000) spells += 1;
    previous = at;
  }
  return spells;
}

/** One unbroken run of days off, as the "who is off" panel shows it. */
export interface LeaveSpell {
  employee_id: string;
  kind: string;
  start_date: string;
  end_date: string;
}

/**
 * Days off grouped back into stretches, for a window.
 *
 * The panel that uses this read `leave_requests` while every number around it read
 * `employee_attendance`, and the two do not describe the same factory: there are 7
 * requests on file against 169 holiday days, because almost every day off here is
 * marked straight onto the board and raises no request at all. "Who is off, next two
 * weeks" was therefore all but empty above a balance table that knew better — the same
 * split the KPIs were moved off months ago, left behind in one panel.
 *
 * Grouping is on CALENDAR days, not working days: somebody off Thursday and the
 * following Monday is two stretches to anybody reading the panel, whatever their rota
 * says about the Friday. Consecutive runs of the same kind join; a change of kind
 * starts a new one, because "sick, then holiday" is two facts.
 */
export function leaveSpellsInWindow(
  days: ReadonlyArray<{ employee_id: string; on_date: string; status?: string | null }>,
  from: string,
  to: string,
  defaultKind = "holiday",
): LeaveSpell[] {
  const inWindow = days.filter((d) => d.on_date >= from && d.on_date <= to);
  const byPerson = new Map<string, { date: string; kind: string }[]>();
  for (const d of inWindow) {
    const kind = (d.status ?? defaultKind) || defaultKind;
    const key = `${d.employee_id}|${kind}`;
    if (!byPerson.has(key)) byPerson.set(key, []);
    byPerson.get(key)!.push({ date: d.on_date, kind });
  }

  const out: LeaveSpell[] = [];
  for (const [key, rows] of byPerson) {
    const [employee_id, kind] = key.split("|");
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    let runStart: string | null = null;
    let previous: number | null = null;
    for (const date of dates) {
      const at = Date.parse(`${date}T00:00:00Z`);
      if (Number.isNaN(at)) continue;
      if (previous !== null && at - previous > 86_400_000) {
        out.push({ employee_id, kind, start_date: runStart!, end_date: new Date(previous).toISOString().slice(0, 10) });
        runStart = date;
      } else if (runStart === null) {
        runStart = date;
      }
      previous = at;
    }
    if (runStart !== null && previous !== null) {
      out.push({ employee_id, kind, start_date: runStart, end_date: new Date(previous).toISOString().slice(0, 10) });
    }
  }
  return out.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.employee_id.localeCompare(b.employee_id));
}
