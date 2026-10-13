import { describe, it, expect } from "vitest";
import { buildClose, countDaysAway } from "@/lib/financeClose";
import {
  buildMyDays, myShifts, summarise, rangeChoices, defaultRange, periodMatching,
  type MyAttendanceData, type MyClockRow,
} from "./myAttendance";

// Mon–Thu, 06:00–18:00, the 44-hour rota. October 2026: Mon 5th … Sun 11th.
const PERIOD = { id: "p-oct", name: "October 2026", start_date: "2026-10-05", end_date: "2026-11-01" };

function data(over: Partial<MyAttendanceData> = {}): MyAttendanceData {
  return {
    me: { id: "e-1", full_name: "Ana Silva", employee_ref: "E045", department: "Production", position: "Operator", shift_group: "Day", started_on: null },
    pattern: { name: "Mon–Thu days", days: [1, 2, 3, 4], starts_at: "06:00", ends_at: "18:00", break_minutes: 60, annual_leave_days: 22.5 },
    clocks: [], clocked_to: null, clocks_imported_at: null, marks: [], holiday_marks: [],
    board: [], requests: [], payroll: [], periods: [PERIOD],
    ...over,
  };
}

const clock = (on_date: string, worked: number, balance: number, extra: Partial<MyClockRow> = {}): MyClockRow => ({
  on_date, start_time: "06:00", end_time: "18:00", worked_minutes: worked, balance_minutes: balance,
  scheduled_minutes: 660, overtime_adj_minutes: 0, absence_name: null, ...extra,
});

const day = (d: MyAttendanceData, date: string, today = "2026-10-20") =>
  buildMyDays(d, date, date, today)[0];

describe("a day is absent only when a record says so", () => {
  it("calls a rostered day with nothing on file 'no record', not absent", () => {
    // Monday 05/10, a rota day, in the past, no clock, no mark: an import that has not
    // happened yet looks exactly like this.
    expect(day(data(), "2026-10-05").status).toBe("no_record");
  });

  it("stays 'no record' even when the clock record reaches past the day", () => {
    // TimeMoto can simply have no row for a day; that is still not a record of absence.
    expect(day(data({ clocked_to: "2026-10-30" }), "2026-10-05").status).toBe("no_record");
  });

  it("is absent when TimeMoto expected the day and recorded nothing worked", () => {
    const d = data({ clocks: [clock("2026-10-05", 0, -660, { start_time: null, end_time: null })] });
    expect(day(d, "2026-10-05").status).toBe("absent");
  });

  it("is absent when somebody marked it absent by hand", () => {
    const d = data({ marks: [{ on_date: "2026-10-05", status: "absent" }] });
    expect(day(d, "2026-10-05")).toMatchObject({ status: "absent", source: "mark" });
  });

  it("is a rest day off the rota, and scheduled on the rota in the future", () => {
    expect(day(data(), "2026-10-09").status).toBe("rest");      // Friday
    expect(day(data(), "2026-10-26").status).toBe("scheduled"); // a Monday after today
    expect(day(data(), "2026-10-30").status).toBe("rest");      // a Friday after today
  });

  it("counts no-record days apart from every absence", () => {
    const d = data();
    const days = buildMyDays(d, "2026-10-05", "2026-10-11", "2026-10-20");
    const s = summarise(d, days, "2026-10-05", "2026-10-11", "2026-10-20");
    expect(s.noRecordDays).toBe(4);
    expect(s.sickDays + s.unpaidDays + s.otherAbsenceDays).toBe(0);
  });
});

describe("overtime is a mark on a present day, never a second day", () => {
  const ot = (on_date: string) => ({ on_date, shift: "Day", status: "overtime", half_day: null });

  it("flags the day and counts it once", () => {
    const d = data({ clocks: [clock("2026-10-05", 750, 90)], board: [ot("2026-10-05")] });
    const days = buildMyDays(d, "2026-10-05", "2026-10-05", "2026-10-20");
    expect(days[0]).toMatchObject({ status: "present", overtime: true });
    expect(summarise(d, days, "2026-10-05", "2026-10-05", "2026-10-20").daysPresent).toBe(1);
  });

  it("does not call extra clocked minutes on a rota day overtime", () => {
    // The "OT" on ordinary days: 90 minutes over schedule is a balance the period
    // settles, deficit first — not an overtime shift.
    const d = data({ clocks: [clock("2026-10-05", 750, 90)] });
    expect(day(d, "2026-10-05")).toMatchObject({ status: "present", overtime: false });
  });

  it("marks work on a rest day as present, and overtime only when it was an overtime shift", () => {
    const worked = clock("2026-10-09", 660, 660, { scheduled_minutes: 0 });
    expect(day(data({ clocks: [worked] }), "2026-10-09")).toMatchObject({ status: "present", overtime: false, due: false });
    expect(day(data({ clocks: [worked], board: [ot("2026-10-09")] }), "2026-10-09"))
      .toMatchObject({ status: "present", overtime: true, due: false });
  });

  it("shows accepted overtime ahead of the day as scheduled, not present", () => {
    // Rosana Cardozo, Saturday 17/10/2026, seen on the 12th.
    const d = data({ board: [ot("2026-10-17")] });
    expect(day(d, "2026-10-17", "2026-10-12")).toMatchObject({ status: "scheduled", overtime: true, due: false });
  });

  it("keeps an ordinary future rota day scheduled and without OT", () => {
    expect(day(data(), "2026-10-15", "2026-10-12")).toMatchObject({ status: "scheduled", overtime: false, due: true });
  });
});

describe("the clock outranks the hand mark, as in the finance close", () => {
  it("shows the clock's absence over a hand mark of present", () => {
    const d = data({
      clocks: [clock("2026-10-05", 0, 0, { absence_name: "Sickness", start_time: null, end_time: null })],
      marks: [{ on_date: "2026-10-05", status: "present" }],
    });
    expect(day(d, "2026-10-05")).toMatchObject({ status: "sick", source: "clock" });
  });

  it("keeps a worked booked-holiday as holiday, with its hours", () => {
    // 24/07 in the real export: Vacation, clocked 06:00–18:00.
    const d = data({ clocks: [clock("2026-10-05", 720, 720, { absence_name: "Vacation" })] });
    const days = buildMyDays(d, "2026-10-05", "2026-10-05", "2026-10-20");
    expect(days[0]).toMatchObject({ status: "holiday", workedOnLeave: true });
    const s = summarise(d, days, "2026-10-05", "2026-10-05", "2026-10-20");
    expect(s).toMatchObject({ holidayDays: 1, daysPresent: 0, workedHours: 12 });
  });

  it("counts days exactly as countDaysAway does", () => {
    const d = data({
      clocks: [clock("2026-10-05", 660, 0), clock("2026-10-06", 0, 0, { absence_name: "Sickness" })],
      marks: [{ on_date: "2026-10-06", status: "present" }, { on_date: "2026-10-07", status: "holiday" }],
    });
    const days = buildMyDays(d, "2026-10-05", "2026-10-11", "2026-10-20");
    const s = summarise(d, days, "2026-10-05", "2026-10-11", "2026-10-20");
    const theirs = countDaysAway(
      d.clocks.map((c) => ({ employee_id: "e-1", ...c })),
      d.marks.map((m) => ({ employee_id: "e-1", ...m })),
    ).get("e-1")!;
    expect(s.daysPresent).toBe(theirs.daysPresent);
    expect(s).toMatchObject({ daysPresent: 1, sickDays: 1, holidayDays: 1 });
  });
});

describe("the board is shown beside the record, never instead of it", () => {
  it("says what the board planned when it disagrees", () => {
    const d = data({
      clocks: [clock("2026-10-05", 660, 0)],
      board: [{ on_date: "2026-10-05", shift: "day", status: "holiday", half_day: false }],
    });
    expect(day(d, "2026-10-05")).toMatchObject({ status: "present", boardSays: "Holiday" });
  });

  it("says nothing when they agree", () => {
    const d = data({
      clocks: [clock("2026-10-05", 660, 0)],
      board: [{ on_date: "2026-10-05", shift: "day", status: "assigned", half_day: false }],
    });
    expect(day(d, "2026-10-05").boardSays).toBeNull();
  });

  it("says nothing when the board never planned the day", () => {
    expect(day(data({ clocks: [clock("2026-10-05", 660, 0)] }), "2026-10-05").boardSays).toBeNull();
  });

  it("does not call a day with no record yet a disagreement", () => {
    const d = data({ board: [{ on_date: "2026-10-05", shift: "day", status: "assigned", half_day: false }] });
    expect(day(d, "2026-10-05")).toMatchObject({ status: "no_record", boardSays: null });
  });
});

describe("pending leave", () => {
  it("marks every day a pending request covers", () => {
    const d = data({ requests: [{ kind: "holiday", start_date: "2026-10-26", end_date: "2026-10-27", status: "pending", working_days: 2 }] });
    const days = buildMyDays(d, "2026-10-25", "2026-10-28", "2026-10-20");
    expect(days.map((x) => x.pending)).toEqual([false, true, true, false]);
  });

  it("does not mark an approved one as pending", () => {
    const d = data({ requests: [{ kind: "holiday", start_date: "2026-10-26", end_date: "2026-10-26", status: "approved", working_days: 1 }] });
    expect(day(d, "2026-10-26").pending).toBe(false);
  });
});

describe("overtime settles only over a whole pay period", () => {
  // Week one 4 h short, week two 6 h over: 2 h of overtime for the period, not 6.
  const clocks = [clock("2026-10-05", 420, -240), clock("2026-10-12", 1020, 360)];

  it("settles a whole pay period with the finance close's own arithmetic", () => {
    const d = data({ clocks });
    const s = summarise(d, buildMyDays(d, PERIOD.start_date, PERIOD.end_date, "2026-11-05"), PERIOD.start_date, PERIOD.end_date, "2026-11-05");
    const [theirs] = buildClose([{
      employeeId: "e-1", name: "Ana Silva", department: "Production", shift: null,
      openingBalanceMin: null, clockedBalanceMin: 120, payrollOtHours: null, absences: {},
      daysPresent: 2, partDayHours: 0, patternName: null, patternDays: [1, 2, 3, 4],
      shiftsWorked: 0, shiftsHoliday: 0, plannedDates: null,
    }], PERIOD.start_date, PERIOD.end_date);
    expect(s.settled).toMatchObject({ overtimeHours: theirs.overtimeHours, owedHours: theirs.owedHours });
    expect(s.settled).toMatchObject({ overtimeHours: 2, owedHours: 0 });
    expect(s.balanceHours).toBe(2);
  });

  it("gives a week a running balance and no overtime at all", () => {
    const d = data({ clocks: [clocks[1]] });
    const s = summarise(d, buildMyDays(d, "2026-10-12", "2026-10-18", "2026-10-20"), "2026-10-12", "2026-10-18", "2026-10-20");
    expect(s.balanceHours).toBe(6);
    expect(s.settled).toBeNull();
  });

  it("states hours short rather than negative overtime", () => {
    const d = data({ clocks: [clocks[0]] });
    const s = summarise(d, [], PERIOD.start_date, PERIOD.end_date, "2026-11-05");
    expect(s.settled).toMatchObject({ overtimeHours: 0, owedHours: 4 });
  });

  it("reports payroll's own hours for that period, apart from the clock's", () => {
    const d = data({ clocks, payroll: [{ period_id: "p-oct", hours: 1.5 }] });
    const s = summarise(d, [], PERIOD.start_date, PERIOD.end_date, "2026-11-05");
    expect(s.payrollHours).toBe(1.5);
    expect(s.settled?.overtimeHours).toBe(2);
  });

  it("has no balance at all when nothing was clocked, rather than a zero", () => {
    const s = summarise(data(), [], PERIOD.start_date, PERIOD.end_date, "2026-11-05");
    expect(s.balanceHours).toBeNull();
    expect(s.settled?.overtimeHours).toBeNull();
  });
});

describe("holiday left", () => {
  it("counts this leave year's marks against the rota's entitlement", () => {
    const d = data({ holiday_marks: ["2026-07-30", "2026-08-03", "2026-10-01", "2026-12-24"] });
    const s = summarise(d, [], "2026-10-05", "2026-10-11", "2026-10-20");
    // 30/07 is last leave year; two taken, one booked.
    expect(s.leave).toMatchObject({ taken: 2, booked: 1, total: 22.5, remaining: 19.5 });
  });

  it("says not available, not zero, when the rota has no entitlement on file", () => {
    const d = data({ pattern: { name: "Sun", days: [7], starts_at: null, ends_at: null, break_minutes: 0, annual_leave_days: null } });
    expect(summarise(d, [], "2026-10-05", "2026-10-11", "2026-10-20").leave.remaining).toBeNull();
  });
});

describe("ranges", () => {
  const periods = [
    { id: "a", name: "Sep 2026", start_date: "2026-09-07", end_date: "2026-10-11" },
    { id: "b", name: "Oct 2026", start_date: "2026-10-12", end_date: "2026-11-08" },
    { id: "c", name: "Nov 2026", start_date: "2026-11-09", end_date: "2026-12-06" },
  ];

  it("opens on the pay period running today", () => {
    expect(defaultRange(periods, "2026-10-12")).toEqual({ from: "2026-10-12", to: "2026-11-08" });
  });

  it("falls back to the calendar month when no period covers today", () => {
    expect(defaultRange([], "2026-10-12")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("offers past periods newest first, never a future one, then weeks and months", () => {
    const c = rangeChoices(periods, "2026-10-12");
    expect(c.map((x) => x.key).slice(0, 2)).toEqual(["period:b", "period:a"]);
    expect(c.find((x) => x.key === "week:this")).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
    expect(c.find((x) => x.key === "month:last")).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(c.some((x) => x.key === "period:c")).toBe(false);
  });

  it("knows a range is a pay period only when it matches exactly", () => {
    expect(periodMatching(periods, "2026-10-12", "2026-11-08")?.id).toBe("b");
    expect(periodMatching(periods, "2026-10-12", "2026-11-07")).toBeNull();
  });
});

describe("where I'm working comes from the Headcount Board", () => {
  const row = (on_date: string, extra: Partial<MyAttendanceData["board"][number]> = {}) =>
    ({ on_date, shift: "Day", status: "assigned", half_day: null, area: "Line 1", area_kind: "production", is_leader: false, ...extra });

  it("gives each day its own column", () => {
    const d = data({ board: [row("2026-10-13", { area: "Gel Line" }), row("2026-10-14")] });
    expect(myShifts(d, "2026-10-13", "2026-10-14").map((s) => [s.date, s.shift, s.area, s.hours]))
      .toEqual([["2026-10-13", "Day", "Gel Line", "06:00–18:00"], ["2026-10-14", "Day", "Line 1", "06:00–18:00"]]);
  });

  it("says not yet assigned for a rota day the board has not placed, never the department", () => {
    const [s] = myShifts(data(), "2026-10-15", "2026-10-15");
    expect(s).toMatchObject({ kind: "scheduled", shift: "Day", area: null });
  });

  it("does not claim 'not assigned' when the database was not asked for the column", () => {
    const old = { on_date: "2026-10-13", shift: "Day", status: "assigned", half_day: null };
    expect(myShifts(data({ board: [old] }), "2026-10-13", "2026-10-13")[0].area).toBeUndefined();
  });

  it("shows cross-shift overtime on the board and hours of the ask, beside the normal day", () => {
    const d = data({
      board: [row("2026-10-13"), row("2026-10-13", { shift: "Night", status: "overtime", area: "Blender Team" })],
      overtime: [{ on_date: "2026-10-13", starts_at: "18:00:00", ends_at: "06:00:00" }],
    });
    expect(myShifts(d, "2026-10-13", "2026-10-13").map((s) => [s.shift, s.kind, s.area, s.hours])).toEqual([
      ["Day", "scheduled", "Line 1", "06:00–18:00"],
      ["Night", "overtime", "Blender Team", "18:00–06:00"],
    ]);
  });

  it("lists accepted overtime the board does not hold yet, unassigned", () => {
    const d = data({ overtime: [{ on_date: "2026-10-17", starts_at: "06:00:00", ends_at: "18:00:00" }] });
    expect(myShifts(d, "2026-10-17", "2026-10-17")).toEqual([
      { date: "2026-10-17", shift: "Day", hours: "06:00–18:00", kind: "overtime", area: null, leader: false },
    ]);
  });

  it("gives an away day no work area", () => {
    const d = data({ board: [row("2026-10-13", { status: "holiday", area: null })] });
    expect(myShifts(d, "2026-10-13", "2026-10-13")[0]).toMatchObject({ kind: "holiday", area: null, hours: null });
  });
});
