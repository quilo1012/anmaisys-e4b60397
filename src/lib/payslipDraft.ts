/**
 * One person's pay period, on one sheet: hours, overtime, schedule and time off.
 * No money (decided 07/11/2026).
 *
 * A DRAFT for the office to check before payroll. It is computed when it is printed
 * and not kept anywhere, and every figure comes from somewhere that already counts it:
 *
 *   - the Finance Close row (`buildClose`) gives shifts, overtime, hours owed, the
 *     payroll figure and the time off, so the sheet and finance's register can never
 *     disagree;
 *   - My Attendance's own reading of the days (`buildMyDays`) gives the day-by-day
 *     table, so the sheet and the employee's phone call each day the same thing;
 *   - the overtime shifts are counted at the Headcount Board's hours
 *     (`summariseOvertimeShifts` with the board's rows).
 *
 * A figure that is missing stays missing: no clock import means "—" and a note saying
 * so, never 0 h.
 */
import type { ClosePerson } from "@/lib/financeClose";
import {
  boardPlacements, buildMyDays, summariseOvertimeShifts,
  type DayStatus, type MyAttendanceData, type MyBoardMark, type MyBoardRow, type MyClockRow,
  type MyMark, type MyOvertimeShiftLine, type MyOvertimeShiftRecord,
} from "@/lib/myAttendance";

export interface PayslipPattern {
  name: string;
  days: number[];
  starts_at: string | null;
  ends_at: string | null;
  break_minutes: number;
}

/** A board row as the office reads it: the marks are on the row itself. */
export type PayslipBoardRow = MyBoardRow & Omit<MyBoardMark, "on_date" | "shift">;

export interface PayslipDraftInput {
  person: ClosePerson & { lineName?: string | null };
  period: { name: string; start_date: string; end_date: string };
  /** The last day counted: the period's end, or the operational day before today while it runs. */
  to: string;
  today: string;
  now: Date;
  pattern: PayslipPattern | null;
  clocks: MyClockRow[];
  marks: MyMark[];
  board: PayslipBoardRow[];
  overtime: MyOvertimeShiftRecord[];
}

export interface PayslipDay {
  date: string;
  /** "06:00–18:00" on a rota day, "Rest" on any other. */
  rota: string;
  clockIn: string | null;
  clockOut: string | null;
  /** Null when the clock has no row for the day. */
  workedHours: number | null;
  status: string;
}

export interface PayslipDraft {
  header: {
    employeeId: string;
    name: string;
    employeeRef: string | null;
    department: string | null;
    line: string | null;
    crew: string | null;
    rota: string | null;
    periodName: string;
    periodFrom: string;
    periodTo: string;
    /** Set while the period is still running: the last day counted. */
    countedTo: string | null;
  };
  schedule: { due: number | null; worked: number; balance: number | null };
  hours: {
    contracted: number | null;
    worked: number | null;
    balance: number | null;
    /** Said under the hours whenever the clock does not cover the period. */
    note: string | null;
  };
  overtime: {
    /**
     * The period's overtime as the employee's phone counts it (My Attendance): the
     * clock's balance plus overtime shifts worked on days the clock has no hours for
     * yet, settled deficit first. Null when there is neither clock nor overtime.
     */
    periodHours: number | null;
    /** "−0.02 h on the clock + 20 h from 2 overtime shifts …", when shifts are added. */
    periodNote: string | null;
    notOnClockHours: number;
    /** Said when overtime went to repay hours short in the period. */
    coveredNote: string | null;
    /** The clock alone — the Finance Close's figure. */
    clockHours: number | null;
    owedHours: number | null;
    /** What payroll keyed. Null = not recorded yet. */
    payrollHours: number | null;
    shifts: MyOvertimeShiftLine[];
    shiftsHours: number;
  };
  absences: {
    holiday: number; sick: number; unpaid: number; other: number; partDayHours: number;
    /** Rota days with nothing worked and no leave booked. */
    absent: number;
    absentDates: string[];
  };
  days: PayslipDay[];
}

const STATUS_WORDS: Record<DayStatus, string> = {
  present: "Present", holiday: "Holiday", sick: "Sick", unpaid: "Unpaid leave",
  absent: "Absent", other: "Other", rest: "Rest day", scheduled: "Scheduled", no_record: "No record yet",
};

const hhmm = (t: string | null | undefined): string | null => {
  if (!t) return null;
  const [h, m] = t.split(":");
  return `${h.padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}`;
};

/** `20/10/2026`, the way the factory writes dates. */
export const ukDate = (d: string) => d.split("-").reverse().join("/");

const r2 = (n: number) => Math.round(n * 100) / 100;
/** "−0.02", "+3", "0" — the minus as a real minus sign, as the sheet prints it. */
const fmtSigned = (n: number) => (n > 0 ? `+${n}` : String(n).replace("-", "−"));
const weekdayShort = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

export function buildPayslipDraft(input: PayslipDraftInput): PayslipDraft {
  const { person, period, to, today, now, pattern } = input;
  const from = period.start_date;
  const inRange = <T extends { on_date: string }>(xs: T[]) => xs.filter((x) => x.on_date >= from && x.on_date <= to);
  const clocks = inRange(input.clocks);
  const board = inRange(input.board);

  const data: MyAttendanceData = {
    me: {
      id: person.employeeId, full_name: person.name, employee_ref: person.employeeRef ?? null,
      department: person.department, position: null, shift_group: person.shift, started_on: null,
    },
    pattern: pattern ? { ...pattern, annual_leave_days: null } : null,
    clocks, clocked_to: null, clocks_imported_at: null,
    marks: inRange(input.marks), holiday_marks: [], board,
    overtime: input.overtime, requests: [], payroll: [], periods: [],
  };

  const rotaHours = pattern?.starts_at && pattern?.ends_at ? `${hhmm(pattern.starts_at)}–${hhmm(pattern.ends_at)}` : "Due";
  const myDays = buildMyDays(data, from, to, today);
  const days: PayslipDay[] = myDays.map((d) => {
    // Holiday, sick and unpaid in one vocabulary; "Training" or "Jury service" by name.
    const words = d.label && (d.status === "other" || d.status === "absent") ? d.label : STATUS_WORDS[d.status];
    return {
      date: d.date,
      rota: d.due ? rotaHours : "Rest",
      clockIn: hhmm(d.clock?.start_time),
      clockOut: hhmm(d.clock?.end_time),
      workedHours: d.clock ? r2((d.clock.worked_minutes ?? 0) / 60) : null,
      status: d.overtime ? `${words} · Overtime` : words,
    };
  });

  const sumMin = (pick: (c: MyClockRow) => number | null) => clocks.reduce((n, c) => n + (pick(c) ?? 0), 0);
  const lastClock = clocks.filter((c) => (c.worked_minutes ?? 0) > 0 || c.absence_name).map((c) => c.on_date).sort().pop() ?? null;
  const hasClock = clocks.length > 0;
  const note = !hasClock
    ? "No clock record has been imported for this period yet."
    : lastClock && lastClock < to ? `Clock record reaches ${ukDate(lastClock)}.` : null;

  const ot = summariseOvertimeShifts(
    input.overtime.filter((o) => o.on_date >= from && o.on_date <= to),
    clocks, now,
    boardPlacements(board, board.map((b) => ({
      on_date: b.on_date, shift: b.shift,
      left_early_at: b.left_early_at, arrived_late_at: b.arrived_late_at, overtime_request_id: b.overtime_request_id,
    }))),
  );

  // Q14: the period's overtime as My Attendance counts it, the clock plus the shifts
  // it has not reached. Q16: when overtime went to repay hours short, say so.
  const clockBalH = person.clockedOtHours;
  const notOnClockH = r2(ot.notOnClockMinutes / 60);
  const periodBal = clockBalH == null && notOnClockH === 0 ? null : r2((clockBalH ?? 0) + notOnClockH);
  const periodNote = notOnClockH > 0
    ? `${fmtSigned(clockBalH ?? 0)} h on the clock + ${notOnClockH} h from ${ot.notOnClock.length} overtime ${ot.notOnClock.length === 1 ? "shift" : "shifts"} the clock has no hours for yet`
    : null;
  const otDatesOnClock = new Set(ot.worked.filter((w) => !ot.notOnClock.includes(w)).map((w) => w.date));
  const otOnClockH = r2(clocks.filter((c) => otDatesOnClock.has(c.on_date)).reduce((n, c) => n + (c.worked_minutes ?? 0), 0) / 60);
  const totalOtH = r2(otOnClockH + notOnClockH);
  const shortH = Math.max(0, r2(-((clockBalH ?? 0) - otOnClockH)));
  const coveredH = r2(Math.min(totalOtH, shortH));
  const absentDays = myDays.filter((x) => x.status === "absent").map((x) => x.date);
  const coveredNote = coveredH > 0
    ? `${coveredH} h of overtime went to cover ${shortH} h short this period${
      absentDays.length > 0 && absentDays.length <= 3
        ? ` (absent ${absentDays.map((x) => `${weekdayShort(x)} ${ukDate(x).slice(0, 5)}`).join(", ")})` : ""
    }. Overtime settles a shortfall first.`
    : null;

  return {
    header: {
      employeeId: person.employeeId,
      name: person.name,
      employeeRef: person.employeeRef ?? null,
      department: person.department,
      line: person.lineName ?? null,
      crew: person.shift,
      rota: person.patternName ?? pattern?.name ?? null,
      periodName: period.name,
      periodFrom: period.start_date,
      periodTo: period.end_date,
      countedTo: to < period.end_date ? to : null,
    },
    schedule: { due: person.shiftsDue, worked: person.shiftsWorked, balance: person.shiftBalance },
    hours: {
      contracted: hasClock ? r2(sumMin((c) => c.scheduled_minutes) / 60) : null,
      worked: hasClock ? r2(sumMin((c) => c.worked_minutes) / 60) : null,
      balance: person.clockedOtHours,
      note,
    },
    overtime: {
      periodHours: periodBal == null ? null : Math.max(0, periodBal),
      periodNote,
      notOnClockHours: notOnClockH,
      coveredNote,
      clockHours: person.overtimeHours,
      // Off the same balance as the period's overtime, so the two never both show.
      owedHours: periodBal == null ? person.owedHours : Math.max(0, r2(-periodBal)),
      payrollHours: person.payrollOtHours,
      shifts: ot.worked,
      shiftsHours: r2(ot.workedMinutes / 60),
    },
    absences: {
      holiday: person.holiday, sick: person.sick, unpaid: person.unpaid,
      other: person.otherAbsence, partDayHours: person.partDayHours,
      absent: absentDays.length, absentDates: absentDays,
    },
    days,
  };
}
