/**
 * What finance is handed at the end of a pay period.
 *
 * The factory keeps overtime in two places and they do not agree. `attendance_days`
 * holds what the clocks recorded; `overtime_entries` holds what the office keyed in
 * from the payroll spreadsheet. On the period this was written the two read 404 hours
 * and 604 hours — a two-hundred-hour disagreement that nobody had reconciled.
 *
 * So this does not add them. It reports both and the gap between them, because a
 * single merged figure would pay one of two numbers without saying which, and hide
 * the fact that there was ever a choice. The delta is the thing to settle before
 * anybody is paid, not overtime to pay.
 *
 * A BALANCE IS NOT OVERTIME, and this file used to treat them as the same number.
 *
 * The contract is a four-day week: twelve hours a day less an hour of unpaid break,
 * so forty-four. Hours are not settled week by week. Somebody who works forty one
 * week and fifty-two the next has not earned eight hours of overtime — the second
 * week is paying back the first, and they are level. Overtime is only what is left
 * over once the shortfall is covered.
 *
 * THE BALANCE RUNS ON BETWEEN PERIODS. It is an hour bank: what somebody is up or
 * down by at the end of one period opens the next. A shortfall is worked off against
 * later hours one for one, and only what is left above zero at the close is overtime.
 *
 * This file said the opposite until 07/08, and both readings have been built. Settling
 * every period to zero was the earlier instruction and it is not the one in force;
 * carrying the balance is. The difference matters most to somebody who is behind —
 * settled, their shortfall is deducted from that period's pay and gone; banked, they
 * work it off. Reverting between the two is not a refactor, so the version in force is
 * named here rather than left to be inferred from the code.
 *
 * Periods are not all four weeks. 07/09 to 11/10 is thirty-five days, and any rule
 * that assumes twenty-eight will drift a week from that date on.
 */

export interface ClosePersonInput {
  employeeId: string;
  name: string;
  department: string | null;
  /**
   * The board this person is drawn on — "Day", "Night", or null when their crew is not
   * recorded.
   *
   * The crew, not the shift of any one allocation. A pay period is a range of days and
   * a person belongs to one crew across it, so this groups cleanly: Day and Night are
   * disjoint, and the two subtotals add up to the whole without counting anybody twice.
   */
  shift: string | null;
  /**
   * Signed minutes carried in from every day before this period — the hour bank as it
   * stood when the period opened.
   *
   * Null means nothing was ever clocked before it: a new starter, or an import that
   * does not reach back that far. Treated as zero in the arithmetic and kept distinct
   * so the screen can say the history is missing rather than settled.
   */
  openingBalanceMin: number | null;
  /** Signed minutes from the clocks within the period. */
  clockedBalanceMin: number | null;
  /** Hours keyed in by the office for this period. */
  payrollOtHours: number | null;
  /** Day counts by absence reason, however the source spelled it. */
  absences: Record<string, number>;
  daysPresent: number;
}

export interface ClosePerson extends ClosePersonInput {
  /**
   * Signed hours over the period: what they worked less what they were due. Not
   * overtime — a week under covers a week over inside the same period, and this can
   * come out negative.
   */
  clockedOtHours: number | null;
  /** The bank as it stood when the period opened. */
  openingHours: number;
  /** opening + period: the bank as it stands at the close, and what carries forward. */
  closingHours: number | null;
  /**
   * The part of the CLOSING balance above zero — hours paid as overtime once every
   * earlier shortfall has been worked off, one for one.
   */
  overtimeHours: number | null;
  /** The part below zero, as a positive number: hours still owed back. */
  owedHours: number | null;
  /** payroll − overtime earned. Positive means payroll is claiming more than the clocks support. */
  deltaHours: number | null;
  sick: number;
  holiday: number;
  unpaid: number;
  otherAbsence: number;
}

/** Names the two sources use for the same thing, folded to one word. */
const SICK = /sick/i;
const HOLIDAY = /holiday|vacation|annual/i;
const UNPAID = /unpaid/i;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function buildClose(rows: ClosePersonInput[]): ClosePerson[] {
  return rows
    .map((r) => {
      // Summing the period's days is what makes a surplus cover a shortfall: forty
      // hours in week one and fifty-two in week two is ninety-two against an
      // eighty-eight hour contract, so four hours of overtime and not twelve.
      const clockedOtHours = r.clockedBalanceMin == null ? null : round2(r.clockedBalanceMin / 60);
      const openingHours = round2((r.openingBalanceMin ?? 0) / 60);

      // The bank at the close. A shortfall brought in is worked off one for one before
      // anything counts as overtime — sixteen hours down and twelve up is four hours
      // still owed, not twelve to pay.
      const closingHours = clockedOtHours == null ? null : round2(openingHours + clockedOtHours);
      const overtimeHours = closingHours == null ? null : Math.max(0, closingHours);
      const owedHours = closingHours == null ? null : Math.max(0, round2(-closingHours));

      // A missing figure is not a zero. If one side never reported, there is no gap
      // to state — saying "0" would read as "the two agree", which is the one thing
      // it does not mean.
      //
      // Compared against overtime earned, not against the balance. Somebody sitting
      // at minus four has earned nothing, and measuring a payroll claim against −4
      // would report a four-hour agreement that does not exist.
      const deltaHours =
        overtimeHours == null || r.payrollOtHours == null
          ? null
          : round2(r.payrollOtHours - overtimeHours);

      let sick = 0, holiday = 0, unpaid = 0, otherAbsence = 0;
      for (const [reason, n] of Object.entries(r.absences)) {
        if (SICK.test(reason)) sick += n;
        else if (HOLIDAY.test(reason)) holiday += n;
        else if (UNPAID.test(reason)) unpaid += n;
        else otherAbsence += n;
      }
      return {
        ...r, clockedOtHours, openingHours, closingHours, overtimeHours, owedHours,
        deltaHours, sick, holiday, unpaid, otherAbsence,
      };
    })
    .sort((a, b) => Math.abs(b.deltaHours ?? -1) - Math.abs(a.deltaHours ?? -1) || a.name.localeCompare(b.name));
}

export interface CloseTotals {
  people: number;
  /** Signed hours accrued in the period. Can be negative; not overtime. */
  clockedOtHours: number;
  /** Hours paid as overtime, after each person's own shortfall is covered. */
  overtimeHours: number;
  /** Hours deducted from pay, across everybody who ended the period behind. */
  owedHours: number;
  payrollOtHours: number;
  deltaHours: number;
  sick: number;
  holiday: number;
  unpaid: number;
  /** People where one side reported and the other did not. */
  unreconciled: number;
  /** Nobody has a payroll figure at all — the whole side of the reconciliation is missing. */
  payrollEmpty: boolean;
}

export function closeTotals(rows: ClosePerson[]): CloseTotals {
  const sum = (f: (r: ClosePerson) => number | null) =>
    round2(rows.reduce((a, r) => a + (f(r) ?? 0), 0));
  return {
    people: rows.length,
    clockedOtHours: sum((r) => r.clockedOtHours),
    // Summed per person, never netted across people. One person's shortfall does not
    // cancel another's overtime — they are paid separately and owe separately.
    overtimeHours: sum((r) => r.overtimeHours),
    owedHours: sum((r) => r.owedHours),
    payrollOtHours: sum((r) => r.payrollOtHours),
    deltaHours: sum((r) => r.deltaHours),
    sick: rows.reduce((a, r) => a + r.sick, 0),
    holiday: rows.reduce((a, r) => a + r.holiday, 0),
    unpaid: rows.reduce((a, r) => a + r.unpaid, 0),
    unreconciled: rows.filter(
      (r) => (r.clockedOtHours == null) !== (r.payrollOtHours == null),
    ).length,
    // A delta of zero across everybody is either perfect agreement or an empty
    // column, and those are opposite facts. On 04/08 not one payroll figure had been
    // keyed, so every delta was null, the sum read 0.00 and the card said "Gap to
    // settle: 0.00 h" — which reads as reconciled and is the most dangerous thing
    // this screen could say to somebody about to pay.
    payrollEmpty: rows.length > 0 && rows.every((r) => r.payrollOtHours == null),
  };
}

/** The rows finance receives, in the order the columns are read. */
export function closeToCsvRows(rows: ClosePerson[]): (string | number)[][] {
  return rows.map((r) => [
    r.name,
    r.shift ?? "",
    r.department ?? "",
    r.openingHours,
    r.clockedOtHours ?? "",
    r.closingHours ?? "",
    r.overtimeHours ?? "",
    r.owedHours ?? "",
    r.payrollOtHours ?? "",
    r.deltaHours ?? "",
    r.daysPresent,
    r.sick,
    r.holiday,
    r.unpaid,
    r.otherAbsence,
  ]);
}

export const CLOSE_HEADERS = [
  "Employee", "Shift", "Department",
  "Opening bank (h)", "Period balance (h)", "Closing bank (h)",
  "Overtime paid (h)", "Hours owed (h)",
  "Payroll OT (h)", "Delta (h)",
  "Days present", "Sick", "Holiday", "Unpaid", "Other absence",
];
