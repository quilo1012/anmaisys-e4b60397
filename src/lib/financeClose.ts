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
 */

export interface ClosePersonInput {
  employeeId: string;
  name: string;
  department: string | null;
  /** Signed minutes from the clocks over the period. */
  clockedBalanceMin: number | null;
  /** Hours keyed in by the office for this period. */
  payrollOtHours: number | null;
  /** Day counts by absence reason, however the source spelled it. */
  absences: Record<string, number>;
  daysPresent: number;
}

export interface ClosePerson extends ClosePersonInput {
  clockedOtHours: number | null;
  /** payroll − clocked. Positive means payroll is claiming more than the clocks saw. */
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
      const clockedOtHours = r.clockedBalanceMin == null ? null : round2(r.clockedBalanceMin / 60);
      // A missing figure is not a zero. If one side never reported, there is no gap
      // to state — saying "0" would read as "the two agree", which is the one thing
      // it does not mean.
      const deltaHours =
        clockedOtHours == null || r.payrollOtHours == null
          ? null
          : round2(r.payrollOtHours - clockedOtHours);

      let sick = 0, holiday = 0, unpaid = 0, otherAbsence = 0;
      for (const [reason, n] of Object.entries(r.absences)) {
        if (SICK.test(reason)) sick += n;
        else if (HOLIDAY.test(reason)) holiday += n;
        else if (UNPAID.test(reason)) unpaid += n;
        else otherAbsence += n;
      }
      return { ...r, clockedOtHours, deltaHours, sick, holiday, unpaid, otherAbsence };
    })
    .sort((a, b) => Math.abs(b.deltaHours ?? -1) - Math.abs(a.deltaHours ?? -1) || a.name.localeCompare(b.name));
}

export interface CloseTotals {
  people: number;
  clockedOtHours: number;
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
    r.department ?? "",
    r.clockedOtHours ?? "",
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
  "Employee", "Department",
  "Clocked OT (h)", "Payroll OT (h)", "Delta (h)",
  "Days present", "Sick", "Holiday", "Unpaid", "Other absence",
];
