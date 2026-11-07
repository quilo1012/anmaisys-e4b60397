import { describe, it, expect } from "vitest";
import {
  summariseOvertimeShifts, boardPlacements, myShifts,
  type MyOvertimeShiftRecord, type MyBoardRow, type MyBoardMark,
} from "@/lib/myAttendance";
import { placementHours } from "@/lib/boardOvertime";

/**
 * 07/11/2026: the Headcount Board had an employee on overtime for 12 hours on Tue 20/10
 * and Wed 21/10; their My Attendance listed both days as 06:00–14:00. The board lays the
 * confirmed ask over the person's row; the app read the ask alone. The app now reads the
 * board's hours (decided 07/11, Q2), and overtime that is only on the board counts too (Q3).
 */
const NOW = new Date("2026-11-07T09:49:00");
const rec = (on_date: string, starts_at: string, ends_at: string, request_id: string, outcome: string | null = null): MyOvertimeShiftRecord =>
  ({ request_id, on_date, starts_at, ends_at, outcome });
const row = (on_date: string, status = "overtime", shift = "Day"): MyBoardRow =>
  ({ on_date, shift, status, half_day: false });
const mark = (on_date: string, m: Partial<MyBoardMark> = {}): MyBoardMark =>
  ({ on_date, shift: "Day", left_early_at: null, arrived_late_at: null, overtime_request_id: null, ...m });

const ASKS = [rec("2026-10-20", "06:00:00", "14:00:00", "q20"), rec("2026-10-21", "06:00:00", "14:00:00", "q21")];

describe("My Attendance reads the board's overtime hours", () => {
  it("20/10 and 21/10: an ask of 06–14 on a row the office placed is the board's 12 hours", () => {
    const board = boardPlacements([row("2026-10-20"), row("2026-10-21")], [mark("2026-10-20"), mark("2026-10-21")]);
    const s = summariseOvertimeShifts(ASKS, [], NOW, board);
    expect(s.worked.map((w) => [w.date, w.hours, w.minutes])).toEqual([
      ["2026-10-20", "06:00–18:00", 720], ["2026-10-21", "06:00–18:00", 720],
    ]);
    expect(s.workedMinutes).toBe(24 * 60);
    expect(s.notOnClockMinutes).toBe(24 * 60);
  });

  it("is the same number the board itself draws for that row", () => {
    const [p] = boardPlacements([row("2026-10-20")], [mark("2026-10-20")]);
    const onBoard = placementHours(
      { status: "overtime", half_day: false, left_early_at: null, arrived_late_at: null, overtime_request_id: null },
      "2026-10-20", "Day",
      [{ request_id: "q20", employee_id: "e", on_date: "2026-10-20", starts_at: "06:00:00", ends_at: "14:00:00" }],
    );
    const s = summariseOvertimeShifts([ASKS[0]], [], NOW, [p]);
    expect(s.worked[0].minutes).toBe(onBoard.total * 60);
    expect(s.worked[0].hours).toBe(onBoard.label);
  });

  // What production showed for the employee of 07/11 (read 07/11): the bridge's row, "went home at 18:00".
  it("the bridge's own row with a stay-late to 18:00 is 12 hours too", () => {
    const board = boardPlacements([row("2026-10-20")],
      [mark("2026-10-20", { overtime_request_id: "q20", left_early_at: "18:00:00" })]);
    const s = summariseOvertimeShifts([ASKS[0]], [], NOW, board);
    expect(s.worked.map((w) => [w.hours, w.minutes])).toEqual([["06:00–18:00", 720]]);
  });

  it("production, 21/10: an ask of 06–14 with \"went home at 16:00\" is 10 hours, as on the board", () => {
    const board = boardPlacements([row("2026-10-21")],
      [mark("2026-10-21", { overtime_request_id: "q21", left_early_at: "16:00:00" })]);
    const s = summariseOvertimeShifts([ASKS[1]], [], NOW, board);
    expect(s.worked.map((w) => [w.hours, w.minutes])).toEqual([["06:00–16:00", 600]]);
  });

  it("the bridge's own row with no marks keeps the ask's 8 hours — the board says 8 as well", () => {
    const board = boardPlacements([row("2026-10-20")], [mark("2026-10-20", { overtime_request_id: "q20" })]);
    const s = summariseOvertimeShifts([ASKS[0]], [], NOW, board);
    expect(s.worked.map((w) => [w.hours, w.minutes])).toEqual([["06:00–14:00", 480]]);
  });

  it("an early finish on the board takes the hours off", () => {
    const board = boardPlacements([row("2026-10-20")],
      [mark("2026-10-20", { overtime_request_id: "q20", left_early_at: "12:00:00" })]);
    const s = summariseOvertimeShifts([ASKS[0]], [], NOW, board);
    expect(s.worked.map((w) => [w.hours, w.minutes])).toEqual([["06:00–12:00", 360]]);
  });

  it("before my_board_marks is pasted, the ask's own hours stay — nothing is guessed", () => {
    const board = boardPlacements([row("2026-10-20"), row("2026-10-21")], null);
    const s = summariseOvertimeShifts(ASKS, [], NOW, board);
    expect(s.worked.map((w) => [w.hours, w.minutes])).toEqual([["06:00–14:00", 480], ["06:00–14:00", 480]]);
  });

  it("a no-show takes the day out, whatever the board row says", () => {
    const board = boardPlacements([row("2026-10-20")], [mark("2026-10-20")]);
    const s = summariseOvertimeShifts([rec("2026-10-20", "06:00:00", "14:00:00", "q20", "no_show")], [], NOW, board);
    expect(s.worked).toEqual([]);
  });

  it("a day the clock has hours for stays the clock's", () => {
    const board = boardPlacements([row("2026-10-20")], [mark("2026-10-20")]);
    const s = summariseOvertimeShifts([ASKS[0]], [{ on_date: "2026-10-20", worked_minutes: 720 }], NOW, board);
    expect(s.workedMinutes).toBe(720);
    expect(s.notOnClockMinutes).toBe(0);
  });
});

describe("overtime that is only on the board counts as worked (13–15/10)", () => {
  it("lists a past board-only overtime day at the board's hours, marked as from the Headcount", () => {
    const board = boardPlacements([row("2026-10-13"), row("2026-10-14")], null);
    const s = summariseOvertimeShifts([], [], NOW, board);
    expect(s.worked.map((w) => [w.date, w.hours, w.minutes, w.where])).toEqual([
      ["2026-10-13", "06:00–18:00", 720, "on the Headcount"],
      ["2026-10-14", "06:00–18:00", 720, "on the Headcount"],
    ]);
    expect(s.workedMinutes).toBe(24 * 60);
  });

  it("uses the board's early finish when it is known", () => {
    const board = boardPlacements([row("2026-10-13")], [mark("2026-10-13", { left_early_at: "14:00:00" })]);
    const s = summariseOvertimeShifts([], [], NOW, board);
    expect(s.worked.map((w) => [w.hours, w.minutes])).toEqual([["06:00–14:00", 480]]);
  });

  it("leaves board-only overtime still to come out of the worked list", () => {
    const board = boardPlacements([row("2026-11-08")], null);
    const s = summariseOvertimeShifts([], [], NOW, board);
    expect(s.worked).toEqual([]);
  });

  it("an assigned row is the rota, not overtime", () => {
    const board = boardPlacements([row("2026-10-16", "assigned")], null);
    expect(summariseOvertimeShifts([], [], NOW, board).worked).toEqual([]);
  });

  it("a night board-only shift ends the next morning", () => {
    const board = boardPlacements([row("2026-11-06", "overtime", "Night")], null);
    const s = summariseOvertimeShifts([], [], new Date("2026-11-07T05:59:00"), board);
    expect(s.worked).toEqual([]);
    const after = summariseOvertimeShifts([], [], new Date("2026-11-07T06:00:00"), board);
    expect(after.worked.map((w) => [w.hours, w.minutes])).toEqual([["18:00–06:00", 720]]);
  });
});

describe("the day's detail reads the board's hours too", () => {
  const data = () => ({
    me: { id: "e", full_name: "X", employee_ref: null, department: null, position: null, shift_group: "Day", started_on: null },
    pattern: { name: "Tue–Fri", days: [5], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 0, annual_leave_days: null },
    clocks: [], clocked_to: null, clocks_imported_at: null, marks: [], holiday_marks: [], requests: [], payroll: [], periods: [],
    board: [{ on_date: "2026-10-20", shift: "Day", status: "overtime", half_day: false, area: "Line 2" }],
    overtime: [{ on_date: "2026-10-20", starts_at: "06:00:00", ends_at: "14:00:00" }],
  });
  it("20/10: an ask of 06–14 with \"went home at 18:00\" reads 06:00–18:00", () => {
    const m = [mark("2026-10-20", { overtime_request_id: "q20", left_early_at: "18:00:00" })];
    expect(myShifts(data(), "2026-10-20", "2026-10-20", m)[0].hours).toBe("06:00–18:00");
  });
  it("keeps the ask's hours while the marks are not readable", () => {
    expect(myShifts(data(), "2026-10-20", "2026-10-20")[0].hours).toBe("06:00–14:00");
  });
});
