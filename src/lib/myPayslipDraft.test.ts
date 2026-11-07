import { describe, it, expect } from "vitest";
import { myPayslipDraft } from "@/lib/myPayslipDraft";
import { summarise, buildMyDays, type MyAttendanceData, type MyClockRow } from "@/lib/myAttendance";

const PERIOD = { id: "oct", name: "October 2026", start_date: "2026-10-12", end_date: "2026-11-08" };
const clock = (on_date: string, worked: number, scheduled = 720): MyClockRow => ({
  on_date, start_time: worked ? "6:00" : null, end_time: worked ? "18:00" : null, worked_minutes: worked,
  balance_minutes: worked - scheduled, scheduled_minutes: scheduled, overtime_adj_minutes: 0, absence_name: null,
});

const DATA: MyAttendanceData = {
  me: { id: "e1", full_name: "Me", employee_ref: "E150", department: "Production", position: null, shift_group: "Day", started_on: null },
  pattern: { name: "Tue–Fri days", days: [2, 3, 4, 5], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 0, annual_leave_days: 22.5 },
  clocks: [clock("2026-10-13", 720), clock("2026-10-14", 720), clock("2026-10-17", 720, 0)],
  clocked_to: "2026-10-17", clocks_imported_at: null,
  marks: [{ on_date: "2026-10-15", status: "sick" }],
  holiday_marks: ["2026-09-10"],
  board: [
    { on_date: "2026-10-13", shift: "Day", status: "assigned", half_day: false },
    { on_date: "2026-10-14", shift: "Day", status: "assigned", half_day: false },
    { on_date: "2026-10-17", shift: "Day", status: "overtime", half_day: false },
    { on_date: "2026-10-20", shift: "Day", status: "overtime", half_day: false },
  ],
  overtime: [{ on_date: "2026-10-20", starts_at: "06:00:00", ends_at: "14:00:00" }],
  requests: [], payroll: [{ period_id: "oct", hours: 6 }], periods: [PERIOD],
};
const OT = [
  { request_id: "q17", on_date: "2026-10-17", starts_at: "06:00:00", ends_at: "18:00:00", outcome: null },
  { request_id: "q20", on_date: "2026-10-20", starts_at: "06:00:00", ends_at: "14:00:00", outcome: null },
];
const MARKS = [
  { on_date: "2026-10-17", shift: "Day", left_early_at: null, arrived_late_at: null, overtime_request_id: "q17" },
  { on_date: "2026-10-20", shift: "Day", left_early_at: "18:00:00", arrived_late_at: null, overtime_request_id: "q20" },
];
const NOW = new Date("2026-11-09T10:00:00");

describe("my own payslip draft", () => {
  const d = myPayslipDraft({ data: DATA, period: PERIOD, today: "2026-11-09", now: NOW, overtime: OT, marks: MARKS });

  it("is mine, for the pay period", () => {
    expect(d.header).toMatchObject({ employeeId: "e1", name: "Me", employeeRef: "E150", periodName: "October 2026", countedTo: null });
  });

  it("says what my phone says for the period's overtime", () => {
    const days = buildMyDays(DATA, PERIOD.start_date, PERIOD.end_date, "2026-11-09");
    // The phone: clock balance + 20/10 (not on the clock) at the board's 12 h.
    const phone = summarise(DATA, days, PERIOD.start_date, PERIOD.end_date, "2026-11-09", 12 * 60);
    expect(d.overtime.periodHours).toBe(phone.settled!.overtimeHours);
    expect(d.overtime.notOnClockHours).toBe(12);
    expect(d.overtime.shifts.map((s) => [s.date, s.hours])).toEqual([["2026-10-17", "06:00–18:00"], ["2026-10-20", "06:00–18:00"]]);
  });

  it("carries the payroll figure and the days away", () => {
    expect(d.overtime.payrollHours).toBe(6);
    expect(d.absences.sick).toBe(1);
    expect(d.schedule.worked).toBe(4);
  });

  it("stops at today while the period is still running, as the office's close does", () => {
    const running = myPayslipDraft({ data: DATA, period: PERIOD, today: "2026-11-01", now: new Date("2026-11-01T10:00:00"), overtime: OT, marks: MARKS });
    expect(running.header.countedTo).toBe("2026-11-01");
    expect(running.days.at(-1)?.date).toBe("2026-11-01");
  });

  it("keeps the ask's hours while the board's marks are not readable", () => {
    const noMarks = myPayslipDraft({ data: DATA, period: PERIOD, today: "2026-11-09", now: NOW, overtime: OT, marks: null });
    expect(noMarks.overtime.shifts.find((s) => s.date === "2026-10-20")?.hours).toBe("06:00–14:00");
  });
});
