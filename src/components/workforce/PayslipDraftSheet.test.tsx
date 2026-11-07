import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildClose, type ClosePersonInput } from "@/lib/financeClose";
import { assemblePayslipDrafts, type PayslipRaw } from "@/components/workforce/payslipDraftData";
import { PayslipDraftSheet } from "@/components/workforce/PayslipDraftSheet";

const PERIOD = { name: "October 2026", start_date: "2026-10-12", end_date: "2026-11-08" };
const base = (id: string, name: string, over: Partial<ClosePersonInput> = {}): ClosePersonInput => ({
  employeeId: id, name, employeeRef: null, lineId: null, department: "Production", shift: "Day",
  openingBalanceMin: null, clockedBalanceMin: null, payrollOtHours: null, absences: {}, daysPresent: 0,
  partDayHours: 0, patternName: "Tue–Fri days", patternDays: [2, 3, 4, 5], shiftsWorked: 0, shiftsHoliday: 0,
  plannedDates: null, ...over,
});
const PATTERN = { name: "Tue–Fri days", days: [2, 3, 4, 5], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 60 };
const CTX = { period: PERIOD, to: PERIOD.end_date, today: "2026-11-09", now: new Date("2026-11-09T10:00:00") };

// `buildClose` sorts its rows, so each draft is found by whose it is.
const pick = (drafts: ReturnType<typeof assemblePayslipDrafts>) => {
  const by = new Map(drafts.map((d) => [d.header.employeeId, d]));
  return [by.get("a")!, by.get("b")!] as const;
};

describe("payslip drafts for the people shown", () => {
  const people = buildClose([
    base("a", "Person A", { clockedBalanceMin: 120, payrollOtHours: 2, absences: { Sick: 1 } }),
    base("b", "Person B"),
  ], PERIOD.start_date, PERIOD.end_date);
  const raw: PayslipRaw = {
    patterns: [{ employee_id: "a", pattern: PATTERN }, { employee_id: "b", pattern: PATTERN }],
    clocks: [{ employee_id: "a", on_date: "2026-10-13", start_time: "6:00", end_time: "18:00", worked_minutes: 780,
      balance_minutes: 120, scheduled_minutes: 660, overtime_adj_minutes: 0, absence_name: null }],
    marks: [{ employee_id: "b", on_date: "2026-10-13", status: "holiday" }],
    board: [], overtime: [],
  };

  it("gives each person their own days, and nobody else's", () => {
    const [a, b] = pick(assemblePayslipDrafts(people, raw, CTX));
    expect(a.days.find((d) => d.date === "2026-10-13")).toMatchObject({ status: "Present", workedHours: 13 });
    expect(b.days.find((d) => d.date === "2026-10-13")).toMatchObject({ status: "Holiday", workedHours: null });
    expect(a.hours.worked).toBe(13);
    expect(b.hours.worked).toBeNull();
  });

  it("prints the draft banner, the four blocks and the days, with no pay amount", () => {
    const [a] = pick(assemblePayslipDrafts(people, raw, CTX));
    render(<PayslipDraftSheet draft={a} generatedAt={new Date("2026-11-09T10:00:00")} />);
    const sheet = screen.getByTestId("payslip-draft");
    expect(sheet).toHaveTextContent(/DRAFT — HOURS ONLY · NOT A PAYSLIP · NO PAY AMOUNTS/);
    for (const t of ["Schedule", "Hours", "Overtime", "Absences"]) expect(screen.getByRole("heading", { name: t })).toBeInTheDocument();
    expect(sheet).toHaveTextContent(/Overtime \(clock\)\s*2 h/);
    expect(sheet).toHaveTextContent(/Approved by payroll\s*2 h/);
    expect(sheet).toHaveTextContent(/Sick\s*1 day/);
    expect(sheet).toHaveTextContent(/Tue 13\/10\/2026\s*06:00–18:00\s*06:00\s*18:00\s*13 h\s*Present/);
    expect(sheet.textContent).not.toMatch(/£|\$|€/);
  });

  it("shows a dash and says why when there is no clock, never 0 h", () => {
    const [, b] = pick(assemblePayslipDrafts(people, raw, CTX));
    render(<PayslipDraftSheet draft={b} generatedAt={new Date()} />);
    const sheet = screen.getByTestId("payslip-draft");
    expect(sheet).toHaveTextContent(/Hours worked\s*—/);
    expect(sheet).toHaveTextContent(/Approved by payroll\s*Not recorded yet/);
    expect(sheet).toHaveTextContent(/No clock record has been imported for this period yet\./);
  });
});
