import { describe, it, expect } from "vitest";
import { buildClose, closeTotals, closeToCsvRows, CLOSE_HEADERS, type ClosePersonInput } from "@/lib/financeClose";

const person = (over: Partial<ClosePersonInput> = {}): ClosePersonInput => ({
  employeeId: "e1", name: "Ana Silva", department: "Production",
  openingBalanceMin: 0, clockedBalanceMin: 0, payrollOtHours: 0, absences: {}, daysPresent: 0, ...over,
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

  describe("a surplus covers a shortfall inside the same period", () => {
    // The contract is a four-day, forty-four hour week and hours are not settled week
    // by week. The pay period is twenty-eight days, so forty hours in week one and
    // fifty-two in week two both fall inside it: the second week pays back the first.
    it("pays only what is left once the shortfall is covered", () => {
      // −4 in one week (40 against 44), +8 in another (52 against 44).
      const r = buildClose([person({ clockedBalanceMin: 4 * 60 })])[0];
      expect(r.clockedOtHours).toBe(4);
      expect(r.overtimeHours).toBe(4);
      expect(r.owedHours).toBe(0);
    });

    it("reports a period that ends short as hours deducted, not as negative overtime", () => {
      // 40 then 48 is four hours short over the fortnight. The screen used to show
      // this as "Clocked OT −4.00", which reads as overtime and is not.
      const r = buildClose([person({ clockedBalanceMin: -4 * 60 })])[0];
      expect(r.clockedOtHours).toBe(-4);
      expect(r.overtimeHours).toBe(0);
      expect(r.owedHours).toBe(4);
    });

    it("measures a payroll claim against overtime paid, not against the balance", () => {
      // Somebody who ended four hours short earned nothing. A payroll claim of 4 h is
      // four unsupported hours, not a figure that agrees with a −4 balance.
      const r = buildClose([person({ clockedBalanceMin: -4 * 60, payrollOtHours: 4 })])[0];
      expect(r.overtimeHours).toBe(0);
      expect(r.deltaHours).toBe(4);
    });

    it("starts each period at zero, because the one before it was settled", () => {
      // Nothing carries in. A deficit already deducted from the previous period's pay
      // must not be deducted again out of this period's overtime.
      const r = buildClose([person({ clockedBalanceMin: 6 * 60 })])[0];
      expect(r.overtimeHours).toBe(6);
    });
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
    // Opening is known — it is zero, not missing — so it stays a number. Everything
    // downstream of the clocks is blank, because nothing was reported to derive it.
    // Opening is known — it is zero, not missing — so it stays a number. Everything
    // downstream of the clocks is blank, because nothing was reported to derive it.
    expect(row[2]).toBe(0);
    for (const i of [3, 4, 5, 6, 7, 8]) expect(row[i]).toBe("");
  });
});

describe("closeTotals across people", () => {
  it("never nets one person's shortfall against another's overtime", () => {
    // They are paid separately and owe separately. Netting would show a factory in
    // balance while one person is owed ten hours and another owes ten.
    const t = closeTotals(buildClose([
      person({ employeeId: "a", clockedBalanceMin: 10 * 60 }),
      person({ employeeId: "b", clockedBalanceMin: -10 * 60 }),
    ]));
    expect(t.overtimeHours).toBe(10);
    expect(t.owedHours).toBe(10);
    expect(t.clockedOtHours).toBe(0);
  });
});

describe("the bank runs on between periods", () => {
  // Settling every period to zero was the earlier instruction and is not the one in
  // force. Both were built; this is the difference between them.
  it("works a carried shortfall off one for one before paying anything", () => {
    // Sixteen hours down when the period opened, twelve up inside it. Four still owed,
    // not twelve to pay — which is what settling each period to zero would have said.
    const r = buildClose([person({ openingBalanceMin: -16 * 60, clockedBalanceMin: 12 * 60 })])[0];
    expect(r.clockedOtHours).toBe(12);
    expect(r.closingHours).toBe(-4);
    expect(r.overtimeHours).toBe(0);
    expect(r.owedHours).toBe(4);
  });

  it("pays what is left once the bank is back above zero", () => {
    const r = buildClose([person({ openingBalanceMin: -4 * 60, clockedBalanceMin: 10 * 60 })])[0];
    expect(r.closingHours).toBe(6);
    expect(r.overtimeHours).toBe(6);
  });

  it("carries a surplus forward instead of losing it", () => {
    const r = buildClose([person({ openingBalanceMin: 5 * 60, clockedBalanceMin: 3 * 60 })])[0];
    expect(r.closingHours).toBe(8);
  });

  it("measures the payroll claim against the bank, not the period alone", () => {
    // Somebody twelve hours up inside a period but still four down overall has earned
    // nothing yet; a claim of twelve is twelve unsupported hours.
    const r = buildClose([person({
      openingBalanceMin: -16 * 60, clockedBalanceMin: 12 * 60, payrollOtHours: 12,
    })])[0];
    expect(r.deltaHours).toBe(12);
  });

  it("treats a missing history as zero without calling it settled", () => {
    const r = buildClose([person({ openingBalanceMin: null, clockedBalanceMin: 6 * 60 })])[0];
    expect(r.openingHours).toBe(0);
    expect(r.overtimeHours).toBe(6);
  });
});
