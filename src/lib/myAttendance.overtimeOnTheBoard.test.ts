/**
 * 30/10/2026, Ailton Junior (E003). Two things his phone got wrong:
 *
 * 1. The office put him on Line 2 as overtime for Sat 31/10 straight on the Headcount,
 *    with no ask. Where I'm working showed it; My Overtime said "0 Accepted".
 * 2. "Overtime for October 2026" said 0 h. It reads the clock alone, his clock record
 *    stopped at 20/10, and his two attended weekend shifts were after it.
 */
import { describe, it, expect } from "vitest";
import {
  overtimeOnTheBoardOnly, summariseOvertimeShifts, summarise, buildMyDays,
  type MyAttendanceData, type MyBoardRow, type MyOvertimeShiftRecord,
} from "./myAttendance";

function data(board: MyBoardRow[], overtime: MyAttendanceData["overtime"] = []): MyAttendanceData {
  return {
    me: { id: "e-003", full_name: "Ailton Junior", employee_ref: "E003", department: "Production", position: "Team Leader", shift_group: "Day", started_on: null },
    pattern: { name: "Tue–Fri days", days: [2, 3, 4, 5], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 0, annual_leave_days: 22.5 },
    clocks: [], clocked_to: "2026-10-20", clocks_imported_at: null, marks: [], holiday_marks: [],
    board, overtime, requests: [], payroll: [], periods: [],
  };
}
const row = (on_date: string, shift: string, status: string, area: string | null = null): MyBoardRow =>
  ({ on_date, shift, status, half_day: false, area, area_kind: "production", is_leader: false });

describe("overtime the office placed on the Headcount by hand", () => {
  it("is found, with its column and the rota's hours — the 31/10 case", () => {
    const d = data([
      row("2026-10-30", "Day", "assigned", "Line 6"),
      row("2026-10-31", "Day", "overtime", "Line 2"),
    ]);
    expect(overtimeOnTheBoardOnly(d, "2026-10-30", "2026-11-12")).toEqual([
      { date: "2026-10-31", shift: "Day", hours: "06:00–18:00", kind: "overtime", area: "Line 2", leader: false },
    ]);
  });

  it("leaves out the bridge's row for an ask the person is booked on, so nothing counts twice", () => {
    const d = data(
      [row("2026-10-24", "Day", "overtime", "Line 3")],
      [{ on_date: "2026-10-24", starts_at: "06:00:00", ends_at: "18:00:00" }],
    );
    expect(overtimeOnTheBoardOnly(d, "2026-10-20", "2026-10-31")).toEqual([]);
  });

  it("matches an ask starting after midnight to the night board of the day before", () => {
    const d = data(
      [row("2026-10-31", "Night", "overtime", "Line 1")],
      [{ on_date: "2026-11-01", starts_at: "02:00:00", ends_at: "06:00:00" }],
    );
    expect(overtimeOnTheBoardOnly(d, "2026-10-30", "2026-11-12")).toEqual([]);
  });

  it("keeps a Day booking when the person's only ask is on the Night board", () => {
    const d = data(
      [row("2026-10-31", "Day", "overtime", null)],
      [{ on_date: "2026-10-31", starts_at: "18:00:00", ends_at: "06:00:00" }],
    );
    const [b] = overtimeOnTheBoardOnly(d, "2026-10-30", "2026-11-12");
    expect(b.shift).toBe("Day");
    expect(b.area).toBeNull();
  });

  it("gives a Night placement the board's own hours when the rota is days", () => {
    const [b] = overtimeOnTheBoardOnly(data([row("2026-11-01", "Night", "overtime", "Line 4")]), "2026-10-30", "2026-11-12");
    expect(b.hours).toBe("18:00–06:00");
  });

  it("ignores ordinary rota rows, absences and days outside the range", () => {
    const d = data([
      row("2026-10-29", "Day", "overtime", "Line 2"),
      row("2026-10-30", "Day", "assigned", "Line 6"),
      row("2026-11-03", "Day", "holiday"),
    ]);
    expect(overtimeOnTheBoardOnly(d, "2026-10-30", "2026-11-12")).toEqual([]);
  });

  it("does not say 'not yet assigned' when the database did not send the column", () => {
    const old = { on_date: "2026-10-31", shift: "Day", status: "overtime", half_day: false } as MyBoardRow;
    const [b] = overtimeOnTheBoardOnly(data([old]), "2026-10-30", "2026-11-12");
    expect(b.area).toBeUndefined();
  });
});

describe("overtime shifts as the supervisor recorded them", () => {
  const rec = (on_date: string, starts_at: string, ends_at: string, outcome: string | null): MyOvertimeShiftRecord =>
    ({ on_date, starts_at, ends_at, outcome });

  // His clock: rota days to 20/10, nothing after.
  const AILTON_CLOCK = ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-20"]
    .map((on_date) => ({ on_date, worked_minutes: 720 }));

  it("counts Ailton's two attended shifts, and says the clock does not have them", () => {
    const s = summariseOvertimeShifts([
      rec("2026-10-25", "06:00:00", "14:00:00", "attended"),
      rec("2026-10-24", "06:00:00", "18:00:00", "attended"),
    ], AILTON_CLOCK, "2026-10-30");
    expect(s.workedMinutes).toBe(20 * 60);
    expect(s.worked.map((w) => [w.date, w.hours])).toEqual([
      ["2026-10-24", "06:00–18:00"], ["2026-10-25", "06:00–14:00"],
    ]);
    expect(s.notOnClock).toHaveLength(2);
    expect(s.notOnClockMinutes).toBe(20 * 60);
  });

  it("leaves a day the clock has hours for to the clock, so nothing counts twice", () => {
    const s = summariseOvertimeShifts([rec("2026-10-24", "06:00:00", "18:00:00", "attended")],
      [...AILTON_CLOCK, { on_date: "2026-10-24", worked_minutes: 720 }], "2026-10-30");
    expect(s.workedMinutes).toBe(720);
    expect(s.notOnClock).toEqual([]);
  });

  it("counts a day the clock has a row for but no worked minutes — the clock has no hours to count", () => {
    const s = summariseOvertimeShifts([rec("2026-10-24", "06:00:00", "18:00:00", "attended")],
      [...AILTON_CLOCK, { on_date: "2026-10-24", worked_minutes: 0 }], "2026-10-30");
    expect(s.notOnClockMinutes).toBe(720);
  });

  it("counts a gap inside the clock's reach too: an import that skipped the day", () => {
    const s = summariseOvertimeShifts([rec("2026-10-18", "06:00:00", "14:00:00", "attended")], AILTON_CLOCK, "2026-10-30");
    expect(s.notOnClockMinutes).toBe(480);
  });

  it("leaves out no-shows, sick calls and cancellations", () => {
    const s = summariseOvertimeShifts([
      rec("2026-10-17", "06:00:00", "18:00:00", "no_show"),
      rec("2026-10-18", "06:00:00", "18:00:00", "called_sick"),
      rec("2026-10-19", "06:00:00", "18:00:00", "cancelled_late"),
    ], AILTON_CLOCK, "2026-10-30");
    expect(s.worked).toEqual([]);
    expect(s.workedMinutes).toBe(0);
    expect(s.unmarked).toEqual([]);
    expect(s.booked).toEqual([]);
  });

  it("splits what has nothing recorded into booked ahead and not marked yet", () => {
    const s = summariseOvertimeShifts([
      rec("2026-10-26", "18:00:00", "06:00:00", null),
      rec("2026-11-01", "06:00:00", "14:00:00", null),
    ], AILTON_CLOCK, "2026-10-30");
    expect(s.unmarked.map((x) => [x.date, x.minutes])).toEqual([["2026-10-26", 720]]);
    expect(s.booked.map((x) => [x.date, x.minutes])).toEqual([["2026-11-01", 480]]);
    expect(s.workedMinutes).toBe(0);
  });
});

describe("the period's overtime counts attended shifts the clock does not have", () => {
  const PERIOD = { id: "p", name: "October 2026", start_date: "2026-10-12", end_date: "2026-11-08" };
  const clockRow = (on_date: string, balance: number) => ({
    on_date, start_time: "6:00", end_time: "18:00", worked_minutes: 720, balance_minutes: balance,
    scheduled_minutes: 720, overtime_adj_minutes: 0, absence_name: null,
  });
  const base = (balances: number[]): MyAttendanceData => ({
    ...data([]),
    clocks: ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-20"].map((d, i) => clockRow(d, balances[i] ?? 0)),
    periods: [PERIOD],
  });
  const settle = (d: MyAttendanceData, added: number) =>
    summarise(d, buildMyDays(d, PERIOD.start_date, PERIOD.end_date, "2026-10-30"), PERIOD.start_date, PERIOD.end_date, "2026-10-30", added).settled!;

  it("Ailton: 0 h on the clock + 20 h attended = 20 h, and says which is which", () => {
    const s = settle(base([0, 0, 0, 0, 0]), 20 * 60);
    expect(s.overtimeHours).toBe(20);
    expect(s.clockOvertimeHours).toBe(0);
    expect(s.attendedHours).toBe(20);
  });

  it("nets a shortfall on the clock against them, as the period always settles", () => {
    const s = settle(base([-120, -120, -120, -120, 0]), 12 * 60); // 8 h short, 12 h attended
    expect(s.overtimeHours).toBe(4);
    expect(s.owedHours).toBe(0);
  });

  it("is the clock's figure, untouched, when there is nothing to add", () => {
    const s = settle(base([90, 0, 0, 0, 0]), 0);
    expect(s.overtimeHours).toBe(1.5);
    expect(s.clockOvertimeHours).toBe(1.5);
    expect(s.attendedHours).toBe(0);
  });
});
