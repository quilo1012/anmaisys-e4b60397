import { describe, it, expect } from "vitest";
import { buildClose, type ClosePersonInput } from "@/lib/financeClose";
import { buildPayslipDraft, type PayslipDraftInput, type PayslipBoardRow } from "@/lib/payslipDraft";
import type { MyClockRow } from "@/lib/myAttendance";

const PERIOD = { name: "October 2026", start_date: "2026-10-12", end_date: "2026-11-08" };
const PATTERN = { name: "Tue–Fri days", days: [2, 3, 4, 5], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 60 };

const clock = (on_date: string, worked: number, extra: Partial<MyClockRow> = {}): MyClockRow => ({
  on_date, start_time: "6:00", end_time: "18:00", worked_minutes: worked, balance_minutes: worked - 660,
  scheduled_minutes: 660, overtime_adj_minutes: 0, absence_name: null, ...extra,
});

function person(over: Partial<ClosePersonInput> = {}) {
  const input: ClosePersonInput = {
    employeeId: "e-150", name: "Test Person", employeeRef: "E150", lineId: "l2", department: "Production",
    shift: "Day", openingBalanceMin: null, clockedBalanceMin: null, payrollOtHours: null,
    absences: {}, daysPresent: 0, partDayHours: 0, patternName: "Tue–Fri days", patternDays: [2, 3, 4, 5],
    shiftsWorked: 0, shiftsHoliday: 0, plannedDates: null, ...over,
  };
  return { ...buildClose([input], PERIOD.start_date, PERIOD.end_date)[0], lineName: "Line 2" };
}

function draft(over: Partial<PayslipDraftInput> = {}) {
  return buildPayslipDraft({
    person: person(), period: PERIOD, to: PERIOD.end_date, today: "2026-11-09",
    now: new Date("2026-11-09T10:00:00"), pattern: PATTERN,
    clocks: [], marks: [], board: [], overtime: [], ...over,
  });
}

describe("payslip draft", () => {
  it("carries the person and the period, and no money anywhere", () => {
    const d = draft();
    expect(d.header).toMatchObject({
      name: "Test Person", employeeRef: "E150", department: "Production", line: "Line 2",
      crew: "Day", rota: "Tue–Fri days", periodName: "October 2026", countedTo: null,
    });
    expect(JSON.stringify(d)).not.toMatch(/£|pay rate|labor_rate|amount/i);
  });

  it("takes shifts, overtime and time off from the Finance Close row, unchanged", () => {
    const p = person({
      clockedBalanceMin: 6 * 60, payrollOtHours: 4, shiftsWorked: 17,
      absences: { Holiday: 2, Sick: 1, "Unpaid Leave": 1, Training: 1 }, partDayHours: 1.5,
    });
    const d = draft({ person: p });
    expect(d.schedule).toEqual({ due: p.shiftsDue, worked: 17, balance: p.shiftBalance });
    expect(d.overtime).toMatchObject({ clockHours: 6, owedHours: 0, payrollHours: 4 });
    expect(d.absences).toEqual({ holiday: 2, sick: 1, unpaid: 1, other: 1, partDayHours: 1.5, absent: 0, absentDates: [] });
    expect(d.hours.balance).toBe(6);
  });

  it("says hours are missing rather than zero when the clock was never imported", () => {
    const d = draft();
    expect(d.hours.worked).toBeNull();
    expect(d.hours.contracted).toBeNull();
    expect(d.hours.balance).toBeNull();
    expect(d.overtime.clockHours).toBeNull();
    expect(d.overtime.payrollHours).toBeNull();
    expect(d.hours.note).toBe("No clock record has been imported for this period yet.");
  });

  it("sums the clock's hours and says where the clock stops", () => {
    const d = draft({ clocks: [clock("2026-10-13", 720), clock("2026-10-14", 600)] });
    expect(d.hours.worked).toBe(22);
    expect(d.hours.contracted).toBe(22);
    expect(d.hours.note).toBe("Clock record reaches 14/10/2026.");
  });

  it("lists every day of the period with the rota, the clock and what the day was", () => {
    const d = draft({
      clocks: [clock("2026-10-13", 720), clock("2026-10-14", 0, { start_time: null, end_time: null, absence_name: "Vacation" })],
      marks: [{ on_date: "2026-10-15", status: "sick" }],
    });
    expect(d.days).toHaveLength(28);
    const byDate = new Map(d.days.map((x) => [x.date, x]));
    expect(byDate.get("2026-10-12")).toMatchObject({ rota: "Rest", status: "Rest day", workedHours: null });
    expect(byDate.get("2026-10-13")).toMatchObject({ rota: "06:00–18:00", clockIn: "06:00", clockOut: "18:00", workedHours: 12, status: "Present" });
    expect(byDate.get("2026-10-14")).toMatchObject({ status: "Holiday", workedHours: 0 });
    expect(byDate.get("2026-10-15")).toMatchObject({ status: "Sick", workedHours: null });
    expect(byDate.get("2026-10-16")).toMatchObject({ status: "No record yet" });
  });

  it("counts overtime shifts at the board's hours: 06–14 asked, stayed until 18:00 (20/10)", () => {
    const board: PayslipBoardRow[] = [{
      on_date: "2026-10-20", shift: "Day", status: "overtime", half_day: false,
      left_early_at: "18:00:00", arrived_late_at: null, overtime_request_id: "q20",
    }];
    const d = draft({
      board,
      overtime: [{ request_id: "q20", on_date: "2026-10-20", starts_at: "06:00:00", ends_at: "14:00:00", outcome: null }],
    });
    expect(d.overtime.shifts.map((s) => [s.date, s.hours])).toEqual([["2026-10-20", "06:00–18:00"]]);
    expect(d.overtime.shiftsHours).toBe(12);
    expect(d.days.find((x) => x.date === "2026-10-20")?.status).toMatch(/Overtime/);
  });

  it("while the period runs, stops at the last day counted and says so", () => {
    const d = draft({ to: "2026-10-31", today: "2026-11-01" });
    expect(d.header.countedTo).toBe("2026-10-31");
    expect(d.days.at(-1)?.date).toBe("2026-10-31");
  });
});

/**
 * 07/11/2026, an employee's October draft: absent Fri 23/10 (12 h short), overtime on
 * Tue 27/10 (11.98 h on the clock) repaid it, and two more overtime shifts on 03/11 and
 * 04/11 came after the clock's last day (02/11). The sheet said 0 h of overtime and
 * 0 days away; her phone counts the two shifts. Decided Q14–Q16.
 */
describe("an October with overtime the clock has not reached, and a shortfall it repaid", () => {
  const ROTA = [1, 5, 6, 7]; // Fri–Mon days
  const pattern = { name: "Fri–Mon days", days: ROTA, starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 0 };
  const rotaDays = ["2026-10-12", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-24", "2026-10-25",
    "2026-10-26", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"];
  const clocks: MyClockRow[] = [
    ...rotaDays.map((d) => clock(d, 720, { scheduled_minutes: 720, balance_minutes: 0 })),
    clock("2026-10-23", 0, { start_time: null, end_time: null, scheduled_minutes: 720, balance_minutes: -720 }),
    clock("2026-10-27", 719, { start_time: "6:01", scheduled_minutes: 0, balance_minutes: 719 }),
  ];
  const balanceMin = clocks.reduce((n, c) => n + (c.balance_minutes ?? 0), 0); // −1 min
  const ot = (id: string, on_date: string, ends_at: string) =>
    ({ request_id: id, on_date, starts_at: "06:00:00", ends_at, outcome: null });
  const bridge = (on_date: string, id: string): PayslipBoardRow =>
    ({ on_date, shift: "Day", status: "overtime", half_day: false, left_early_at: null, arrived_late_at: null, overtime_request_id: id });

  const d = buildPayslipDraft({
    person: person({ patternName: "Fri–Mon days", patternDays: ROTA, clockedBalanceMin: balanceMin, shiftsWorked: 16 }),
    period: PERIOD, to: "2026-11-07", today: "2026-11-07", now: new Date("2026-11-07T20:24:00"), pattern,
    clocks, marks: [], board: [bridge("2026-10-27", "q1"), bridge("2026-11-03", "q2"), bridge("2026-11-04", "q3")],
    overtime: [ot("q1", "2026-10-27", "18:00:00"), ot("q2", "2026-11-03", "18:00:00"), ot("q3", "2026-11-04", "14:00:00")],
  });

  it("counts the period's overtime as her phone does: the clock plus the shifts it has not reached", () => {
    expect(d.overtime.clockHours).toBe(0);
    expect(d.overtime.notOnClockHours).toBe(20);
    expect(d.overtime.periodHours).toBe(19.98);
    // Off the same balance: no "0.02 h owed" beside 19.98 h of overtime.
    expect(d.overtime.owedHours).toBe(0);
    expect(d.overtime.periodNote).toBe("−0.02 h on the clock + 20 h from 2 overtime shifts the clock has no hours for yet");
  });

  it("lists the day she was away with no leave booked", () => {
    expect(d.absences.absent).toBe(1);
    expect(d.absences.absentDates).toEqual(["2026-10-23"]);
  });

  // 11.98 h from 27/10 and the last 0.02 h from 03/11: the whole 12 h was repaid.
  it("says the overtime went to cover the day short", () => {
    expect(d.overtime.coveredNote).toBe(
      "12 h of overtime went to cover 12 h short this period (absent Fri 23/10). Overtime settles a shortfall first.",
    );
  });

  it("says nothing about covering when nothing was short", () => {
    const plain = buildPayslipDraft({
      person: person({ clockedBalanceMin: 719 }), period: PERIOD, to: PERIOD.end_date, today: "2026-11-09",
      now: new Date("2026-11-09T10:00:00"), pattern: PATTERN,
      clocks: [clock("2026-10-13", 720, { scheduled_minutes: 720, balance_minutes: 0 }), clock("2026-10-17", 719, { scheduled_minutes: 0, balance_minutes: 719 })],
      marks: [], board: [bridge("2026-10-17", "q9")], overtime: [ot("q9", "2026-10-17", "18:00:00")],
    });
    expect(plain.overtime.coveredNote).toBeNull();
    expect(plain.overtime.periodHours).toBe(11.98);
    expect(plain.overtime.periodNote).toBeNull();
  });

  it("leaves the period's overtime unknown when there is neither clock nor overtime", () => {
    const empty = draft();
    expect(empty.overtime.periodHours).toBeNull();
  });
});

describe("holiday left this leave year", () => {
  it("counts the leave year's holiday marks against the rota's entitlement, as the phone does", () => {
    const d = draft({
      pattern: { ...PATTERN, annual_leave_days: 22.5 },
      today: "2026-11-09",
      holidayMarks: ["2026-07-30", "2026-08-03", "2026-09-10", "2026-12-24"],
    });
    // 30/07 is last leave year (it starts 01/08); 03/08 and 10/09 are taken; 24/12 is booked.
    expect(d.leave).toEqual({ taken: 2, booked: 1, total: 22.5, remaining: 19.5 });
  });

  it("is not shown when the marks were not read", () => {
    expect(draft().leave).toBeNull();
  });

  it("says when no entitlement is on file, instead of a number", () => {
    const d = draft({ holidayMarks: ["2026-09-10"], today: "2026-11-09" });
    expect(d.leave).toMatchObject({ taken: 1, total: null, remaining: null });
  });
});
