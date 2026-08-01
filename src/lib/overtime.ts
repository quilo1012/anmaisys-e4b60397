/**
 * The factory's overtime arithmetic, as a pure function.
 *
 * NOTHING FEEDS THIS YET. `employee_attendance` records a status per person per day
 * — present, absent, sick, holiday, unpaid, training — and no hours at all. There is
 * no clock-in, no clock-out and no daily total anywhere in the schema. The rules are
 * written here because they are the factory's and they are stable; the input has to
 * arrive from TimeMoto before any screen can call this.
 *
 * A second warning, which matters more. `overtime_entries` holds a COPY of the
 * payroll spreadsheet, and a database trigger refuses hand-written hours, because
 * the spreadsheet and the clock-ins already disagree: 604.05 h against 404.41 h over
 * 08 Jun – 12 Jul 2026. This function computing a third figure does not resolve that
 * disagreement — it adds to it. Nothing here should be written into
 * `overtime_entries` until somebody decides which system the factory pays from.
 */

/** One day a person was on site, before any deduction. */
export interface WorkedDay {
  /** yyyy-mm-dd. */
  date: string;
  /** Clock-out minus clock-in, in hours, exactly as the time system reports it. */
  totalHours: number;
  /**
   * True when the person's shift pattern covers this day.
   *
   * This is the only thing that decides the break deduction, so it is a required
   * field rather than something inferred here — inferring "it was a Saturday, so it
   * must be overtime" would be wrong for every weekend shift pattern in the factory.
   */
  scheduled: boolean;
}

export interface OvertimeRules {
  /** Contractual hours a full week is expected to cover. */
  weeklyTargetHours: number;
  /** Unpaid break taken off a scheduled day. */
  breakHours: number;
}

export const DEFAULT_RULES: OvertimeRules = {
  weeklyTargetHours: 44,
  breakHours: 1,
};

export interface PeriodResult {
  /** Hours after break deductions, summed over the period. */
  workedHours: number;
  /** Hours before break deductions. Kept so a payslip query can show both. */
  rawHours: number;
  /** Total break hours taken off. */
  breakHours: number;
  /** Length of the period, in weeks. Fractional when it is not a whole number. */
  weeks: number;
  /** weeks × weeklyTargetHours, less any excused hours. */
  targetHours: number;
  /**
   * Worked minus target.
   *
   * Negative is a real answer, not bad data: a period with sickness in it produces a
   * deficit, and the payroll spreadsheet carries balances as low as −68.5 h.
   */
  netOvertime: number;
  /** Days counted, split by which rule applied to them. */
  scheduledDays: number;
  overtimeDays: number;
}

/**
 * Hours actually worked on one day.
 *
 * A scheduled day loses the break; a day worked outside the pattern does not, because
 * nobody takes an unpaid lunch on a shift they came in specially for.
 *
 * Clamped at zero. Somebody clocked in for forty minutes on a scheduled day has
 * worked no hours, not minus twenty minutes, and letting that go negative would
 * quietly pay the deficit back out of somebody else's overtime later in the period.
 */
export function workedHoursForDay(day: WorkedDay, rules: OvertimeRules = DEFAULT_RULES): number {
  const raw = Math.max(0, day.totalHours);
  if (!day.scheduled) return raw;
  return Math.max(0, raw - rules.breakHours);
}

/** Whole days from start to end, both ends included. */
function daysInclusive(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) throw new Error("Period dates must be yyyy-mm-dd");
  if (end < start) throw new Error("Period ends before it starts");
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Overtime across a whole pay period, not week by week.
 *
 * The period is the unit on purpose. A week under target is not a debt to be settled
 * on its own: 32 h in week one and 56 h in week two is 88 h against an 88 h target,
 * which is zero overtime — the surplus covers the shortfall because both fall inside
 * the same period. Paying the +12 and separately docking the −12 would pay somebody
 * overtime for a fortnight in which they worked exactly their contract.
 *
 * @param excusedHours Hours the factory has agreed not to expect — certified sickness
 *   written off against banked hours, for instance. They come off the target, so an
 *   excused week neither earns overtime nor creates a deficit. Defaults to zero, and
 *   the caller has to be explicit, because deciding what is excused is a payroll
 *   judgement and not one this function can make.
 */
export function calculatePeriodOvertime(
  days: WorkedDay[],
  periodStart: string,
  periodEnd: string,
  options: { rules?: OvertimeRules; excusedHours?: number } = {},
): PeriodResult {
  const rules = options.rules ?? DEFAULT_RULES;
  const excusedHours = options.excusedHours ?? 0;

  const inPeriod = days.filter((d) => d.date >= periodStart && d.date <= periodEnd);

  let rawHours = 0;
  let workedHours = 0;
  let scheduledDays = 0;
  let overtimeDays = 0;

  for (const day of inPeriod) {
    const raw = Math.max(0, day.totalHours);
    rawHours += raw;
    workedHours += workedHoursForDay(day, rules);
    if (day.scheduled) scheduledDays += 1;
    else overtimeDays += 1;
  }

  const weeks = daysInclusive(periodStart, periodEnd) / 7;
  const targetHours = weeks * rules.weeklyTargetHours - excusedHours;

  return {
    workedHours: round2(workedHours),
    rawHours: round2(rawHours),
    breakHours: round2(rawHours - workedHours),
    weeks: round2(weeks),
    targetHours: round2(targetHours),
    netOvertime: round2(workedHours - targetHours),
    scheduledDays,
    overtimeDays,
  };
}

/**
 * Payroll figures are quoted to the penny of an hour; floating point is not.
 *
 * The `|| 0` collapses negative zero, which arithmetic on a balance of exactly the
 * contract produces and which would print as "-0h" on somebody's payslip.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100 || 0;
}
