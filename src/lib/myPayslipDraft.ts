/**
 * The employee's own payslip draft, from what My Attendance already holds.
 *
 * The office prints the same sheet from the Finance Close (`assemblePayslipDrafts`).
 * Here the person is built from `my_attendance` the way My Attendance's own summary
 * builds it — the clock first, the hand mark for a day the clock did not record, the
 * board's rows for shifts — so the sheet says what the phone says. No money, nothing
 * stored (decided 07/11/2026).
 */
import { buildClose, countDaysAway, round2 } from "@/lib/financeClose";
import { partDay } from "@/lib/partDay";
import { periodElapsedTo } from "@/lib/shiftBalance";
import type { MyAttendanceData, MyBoardMark, MyOvertimeShiftRecord, MyPeriod } from "@/lib/myAttendance";
import { buildPayslipDraft, type PayslipBoardRow, type PayslipDraft } from "@/lib/payslipDraft";

export function myPayslipDraft(args: {
  data: MyAttendanceData;
  period: MyPeriod;
  today: string;
  now: Date;
  overtime: MyOvertimeShiftRecord[];
  /** `my_board_marks`; null while it is not readable. */
  marks: ReadonlyArray<MyBoardMark> | null;
}): PayslipDraft {
  const { data, period, today, now, overtime, marks } = args;
  const from = period.start_date;
  // The days that have happened, as the office's close counts them.
  const to = periodElapsedTo(period.end_date, today);
  const inRange = <T extends { on_date: string }>(xs: T[]) => xs.filter((x) => x.on_date >= from && x.on_date <= to);
  const id = data.me.id;
  const clocks = inRange(data.clocks);
  const markOf = new Map((marks ?? []).map((m) => [`${m.on_date}|${m.shift}`, m]));
  const board: PayslipBoardRow[] = inRange(data.board).map((b) => {
    const m = markOf.get(`${b.on_date}|${b.shift}`);
    return { ...b, left_early_at: m?.left_early_at ?? null, arrived_late_at: m?.arrived_late_at ?? null, overtime_request_id: m?.overtime_request_id ?? null };
  });

  const counted = countDaysAway(
    clocks.map((c) => ({ employee_id: id, on_date: c.on_date, worked_minutes: c.worked_minutes, absence_name: c.absence_name })),
    inRange(data.marks).map((m) => ({ employee_id: id, on_date: m.on_date, status: m.status })),
  ).get(id) ?? { daysPresent: 0, absences: {} };
  const payroll = data.payroll.filter((p) => p.period_id === period.id);
  const p = data.pattern;
  let partDayHours = 0;
  if (p && marks) {
    for (const b of board) {
      if (!b.left_early_at && !b.arrived_late_at) continue;
      const cut = partDay({ arrivedLateAt: b.arrived_late_at, leftEarlyAt: b.left_early_at },
        { startsAt: p.starts_at, endsAt: p.ends_at, breakMinutes: p.break_minutes });
      if (cut) partDayHours = round2(partDayHours + cut.missedHours);
    }
  }

  const person = buildClose([{
    employeeId: id, name: data.me.full_name, employeeRef: data.me.employee_ref, department: data.me.department,
    shift: data.me.shift_group, lineId: null, lineName: null,
    openingBalanceMin: null,
    clockedBalanceMin: clocks.some((c) => c.balance_minutes != null)
      ? clocks.reduce((n, c) => n + (c.balance_minutes ?? 0), 0) : null,
    payrollOtHours: payroll.length ? round2(payroll.reduce((n, x) => n + Number(x.hours), 0)) : null,
    absences: counted.absences, daysPresent: counted.daysPresent, partDayHours,
    patternName: p?.name ?? null, patternDays: p?.days ?? null,
    shiftsWorked: board.filter((b) => b.status === "assigned" || b.status === "overtime").length,
    shiftsHoliday: board.filter((b) => b.status === "holiday").length,
    plannedDates: null,
  }], from, to)[0];

  return buildPayslipDraft({
    person, period, to, today, now,
    pattern: p ? { name: p.name, days: p.days, starts_at: p.starts_at, ends_at: p.ends_at, break_minutes: p.break_minutes, annual_leave_days: p.annual_leave_days } : null,
    clocks, marks: data.marks, board, overtime,
    holidayMarks: data.holiday_marks,
    boardMarksKnown: marks != null,
  });
}
