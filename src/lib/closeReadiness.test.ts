import { describe, it, expect } from "vitest";
import { buildClose, type ClosePersonInput } from "@/lib/financeClose";
import { buildPayslipDraft, type PayslipBoardRow } from "@/lib/payslipDraft";
import type { MyClockRow } from "@/lib/myAttendance";
import { closeReadiness } from "@/lib/closeReadiness";

const PERIOD = { name: "October 2026", start_date: "2026-10-12", end_date: "2026-11-08" };
const PATTERN = { name: "Fri–Mon days", days: [1, 5, 6, 7], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 0 };
const clock = (on_date: string, worked: number, scheduled = 720): MyClockRow => ({
  on_date, start_time: worked ? "6:00" : null, end_time: worked ? "18:00" : null, worked_minutes: worked,
  balance_minutes: worked - scheduled, scheduled_minutes: scheduled, overtime_adj_minutes: 0, absence_name: null,
});
const input = (id: string, name: string, over: Partial<ClosePersonInput> = {}): ClosePersonInput => ({
  employeeId: id, name, employeeRef: null, lineId: null, department: "Production", shift: "Day",
  openingBalanceMin: null, clockedBalanceMin: null, payrollOtHours: null, absences: {}, daysPresent: 0,
  partDayHours: 0, patternName: PATTERN.name, patternDays: PATTERN.days, shiftsWorked: 0, shiftsHoliday: 0,
  plannedDates: null, ...over,
});

// The 07/11 case: away 23/10 with nothing booked, overtime 27/10 on the clock, two more
// shifts (03/11, 04/11) after the clock's last day (02/11).
const clocksA = [clock("2026-10-19", 720), clock("2026-10-23", 0), clock("2026-10-27", 719, 0), clock("2026-11-02", 720)];
const balA = clocksA.reduce((n, c) => n + (c.balance_minutes ?? 0), 0);
const rows = buildClose([
  input("a", "Person A", { clockedBalanceMin: balA }),
  input("b", "Person B", { clockedBalanceMin: 240 }),
], PERIOD.start_date, PERIOD.end_date);
const rowOf = (id: string) => rows.find((r) => r.employeeId === id)!;
const bridge = (on_date: string, id: string): PayslipBoardRow =>
  ({ on_date, shift: "Day", status: "overtime", half_day: false, left_early_at: null, arrived_late_at: null, overtime_request_id: id });
const ask = (id: string, on_date: string, ends_at: string) => ({ request_id: id, on_date, starts_at: "06:00:00", ends_at, outcome: null });
const ctx = { period: PERIOD, to: "2026-11-07", today: "2026-11-07", now: new Date("2026-11-07T20:00:00"), pattern: PATTERN, marks: [] };
const drafts = [
  buildPayslipDraft({
    ...ctx, person: rowOf("a"), clocks: clocksA,
    board: [bridge("2026-10-27", "q1"), bridge("2026-11-03", "q2"), bridge("2026-11-04", "q3")],
    overtime: [ask("q1", "2026-10-27", "18:00:00"), ask("q2", "2026-11-03", "18:00:00"), ask("q3", "2026-11-04", "14:00:00")],
  }),
  buildPayslipDraft({ ...ctx, person: rowOf("b"), clocks: [clock("2026-10-19", 960)], board: [], overtime: [] }),
];

describe("is this period ready to close", () => {
  const r = closeReadiness({ rows, drafts, clockReach: "2026-11-02", to: "2026-11-07", pendingBlocks: [] });
  const item = (k: string) => r.items.find((i) => i.key === k)!;

  it("blocks while the clock stops short of the period", () => {
    expect(item("clock")).toMatchObject({ level: "block", title: "Clock records reach 02/11: 5 days of the period have no hours yet" });
    expect(r.ready).toBe(false);
  });

  it("names who has overtime the clock does not have, and how much", () => {
    expect(item("overtimeNotOnClock")).toMatchObject({ level: "block", title: "1 person has 20 h of overtime the clock does not have yet" });
    expect(item("overtimeNotOnClock").people).toEqual([{ employeeId: "a", name: "Person A", detail: "20 h, 03/11 + 04/11" }]);
  });

  it("names who was away on a rota day with nothing booked", () => {
    expect(item("absentNoLeave").people).toEqual([{ employeeId: "a", name: "Person A", detail: "23/10" }]);
    expect(item("absentNoLeave").level).toBe("check");
  });

  it("names who has clock overtime and no payroll figure", () => {
    expect(item("payrollMissing").people.map((p) => p.employeeId)).toEqual(["b"]);
  });

  it("is ready once the clock covers the period and nothing blocks", () => {
    const done = closeReadiness({
      rows: [rowOf("b")], drafts: [drafts[1]], clockReach: "2026-11-08", to: "2026-11-08", pendingBlocks: [],
    });
    expect(done.ready).toBe(true);
    expect(done.items.find((i) => i.key === "clock")?.level).toBe("ok");
    expect(done.open).toBe(1); // the payroll figure is still worth a look
  });

  it("says when the clock was never imported", () => {
    const none = closeReadiness({ rows, drafts: null, clockReach: null, to: "2026-11-07", pendingBlocks: [] });
    expect(none.items[0]).toMatchObject({ level: "block", title: "No clock record has been imported for this period" });
    // Without the drafts it does not guess about overtime or absences.
    expect(none.items.map((i) => i.key)).not.toContain("overtimeNotOnClock");
  });

  it("lists a database block the screens are waiting on", () => {
    const p = closeReadiness({ rows, drafts, clockReach: "2026-11-07", to: "2026-11-07", pendingBlocks: ["BLOCO 153 — my_board_marks"] });
    expect(p.items.find((i) => i.key === "pendingBlocks")).toMatchObject({ level: "check", title: "Database update not applied: BLOCO 153 — my_board_marks" });
  });
});
