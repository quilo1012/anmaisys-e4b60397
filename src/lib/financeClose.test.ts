import { describe, it, expect } from "vitest";
import { buildClose, closeTotals, closeToCsvRows, CLOSE_HEADERS, type ClosePersonInput } from "@/lib/financeClose";

const person = (over: Partial<ClosePersonInput> = {}): ClosePersonInput => ({
  employeeId: "e1", name: "Ana Silva", department: "Production",
  clockedBalanceMin: 0, payrollOtHours: 0, absences: {}, daysPresent: 0, ...over,
});

describe("buildClose", () => {
  it("turns clocked minutes into hours", () => {
    expect(buildClose([person({ clockedBalanceMin: 450 })])[0].clockedOtHours).toBe(7.5);
    expect(buildClose([person({ clockedBalanceMin: -90 })])[0].clockedOtHours).toBe(-1.5);
  });

  it("reports the gap rather than a merged total", () => {
    // The whole point: 604 and 404 must not become one number.
    const r = buildClose([person({ clockedBalanceMin: 60 * 404, payrollOtHours: 604 })])[0];
    expect(r.clockedOtHours).toBe(404);
    expect(r.payrollOtHours).toBe(604);
    expect(r.deltaHours).toBe(200);
  });

  it("leaves the gap unstated when only one side reported", () => {
    // A missing figure is not a zero. "0" would read as "the two agree", which is
    // the one thing it does not mean.
    expect(buildClose([person({ clockedBalanceMin: null, payrollOtHours: 12 })])[0].deltaHours).toBeNull();
    expect(buildClose([person({ clockedBalanceMin: 600, payrollOtHours: null })])[0].deltaHours).toBeNull();
  });

  it("folds the two sources' spellings into one word each", () => {
    // TimeMoto says Vacation and Sickness; the manual marks say holiday and sick.
    const r = buildClose([person({
      absences: { Sickness: 2, sick: 1, Vacation: 3, holiday: 1, "Unpaid Leave": 2, "Jury Service": 1 },
    })])[0];
    expect(r.sick).toBe(3);
    expect(r.holiday).toBe(4);
    expect(r.unpaid).toBe(2);
    expect(r.otherAbsence).toBe(1);
  });

  it("puts the biggest disagreement at the top, either direction", () => {
    const rows = buildClose([
      person({ employeeId: "a", name: "Small", clockedBalanceMin: 60, payrollOtHours: 2 }),
      person({ employeeId: "b", name: "Big under", clockedBalanceMin: 60 * 50, payrollOtHours: 10 }),
      person({ employeeId: "c", name: "Agrees", clockedBalanceMin: 60 * 5, payrollOtHours: 5 }),
    ]);
    expect(rows[0].name).toBe("Big under");
    expect(rows[0].deltaHours).toBe(-40);
    expect(rows[2].name).toBe("Agrees");
  });
});

describe("closeTotals", () => {
  it("counts the people whose two sides cannot be compared", () => {
    const rows = buildClose([
      person({ employeeId: "a", clockedBalanceMin: 60, payrollOtHours: 1 }),
      person({ employeeId: "b", name: "No clock", clockedBalanceMin: null, payrollOtHours: 8 }),
      person({ employeeId: "c", name: "No payroll", clockedBalanceMin: 120, payrollOtHours: null }),
    ]);
    expect(closeTotals(rows).unreconciled).toBe(2);
  });

  it("sums each side separately and never merges them", () => {
    const rows = buildClose([
      person({ employeeId: "a", clockedBalanceMin: 60 * 10, payrollOtHours: 15 }),
      person({ employeeId: "b", clockedBalanceMin: 60 * 4, payrollOtHours: 4 }),
    ]);
    const t = closeTotals(rows);
    expect(t.clockedOtHours).toBe(14);
    expect(t.payrollOtHours).toBe(19);
    expect(t.deltaHours).toBe(5);
    expect(t.people).toBe(2);
  });
});

describe("the export finance receives", () => {
  it("has a column for every header", () => {
    const rows = buildClose([person({ clockedBalanceMin: 90, payrollOtHours: 2, daysPresent: 4 })]);
    expect(closeToCsvRows(rows)[0]).toHaveLength(CLOSE_HEADERS.length);
  });

  it("leaves a cell blank rather than writing a zero nobody reported", () => {
    const rows = buildClose([person({ clockedBalanceMin: null, payrollOtHours: null })]);
    const [row] = closeToCsvRows(rows);
    expect(row[2]).toBe("");
    expect(row[3]).toBe("");
    expect(row[4]).toBe("");
  });
});
