import { describe, it, expect } from "vitest";
import { buildClose, closeTotals, closeToCsvRows, CLOSE_HEADERS, type ClosePersonInput } from "@/lib/financeClose";

/** 13/07–09/08/2026: the period this file was written against, 28 days. */
const PERIOD = { from: "2026-07-13", to: "2026-08-09" };

const person = (over: Partial<ClosePersonInput> = {}): ClosePersonInput => ({
  employeeId: "e1", name: "Ana Silva", department: "Production", shift: "Day", earlyLeaveHours: 0,
  patternName: null, patternDays: null, shiftsWorked: 0, shiftsHoliday: 0, plannedDates: null,
  openingBalanceMin: 0, clockedBalanceMin: 0, payrollOtHours: 0, absences: {}, daysPresent: 0, ...over,
});

describe("buildClose", () => {
  it("turns clocked minutes into hours", () => {
    expect(buildClose([person({ clockedBalanceMin: 450 })], PERIOD.from, PERIOD.to)[0].clockedOtHours).toBe(7.5);
    expect(buildClose([person({ clockedBalanceMin: -90 })], PERIOD.from, PERIOD.to)[0].clockedOtHours).toBe(-1.5);
  });

  it("reports the gap rather than a merged total", () => {
    // The whole point: 604 and 404 must not become one number.
    const r = buildClose([person({ clockedBalanceMin: 60 * 404, payrollOtHours: 604 })], PERIOD.from, PERIOD.to)[0];
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
      const r = buildClose([person({ clockedBalanceMin: 4 * 60 })], PERIOD.from, PERIOD.to)[0];
      expect(r.clockedOtHours).toBe(4);
      expect(r.overtimeHours).toBe(4);
      expect(r.owedHours).toBe(0);
    });

    it("reports a period that ends short as hours deducted, not as negative overtime", () => {
      // 40 then 48 is four hours short over the fortnight. The screen used to show
      // this as "Clocked OT −4.00", which reads as overtime and is not.
      const r = buildClose([person({ clockedBalanceMin: -4 * 60 })], PERIOD.from, PERIOD.to)[0];
      expect(r.clockedOtHours).toBe(-4);
      expect(r.overtimeHours).toBe(0);
      expect(r.owedHours).toBe(4);
    });

    it("measures a payroll claim against overtime paid, not against the balance", () => {
      // Somebody who ended four hours short earned nothing. A payroll claim of 4 h is
      // four unsupported hours, not a figure that agrees with a −4 balance.
      const r = buildClose([person({ clockedBalanceMin: -4 * 60, payrollOtHours: 4 })], PERIOD.from, PERIOD.to)[0];
      expect(r.overtimeHours).toBe(0);
      expect(r.deltaHours).toBe(4);
    });

    it("starts each period at zero, because the one before it was settled", () => {
      // Nothing carries in. A deficit already deducted from the previous period's pay
      // must not be deducted again out of this period's overtime.
      const r = buildClose([person({ clockedBalanceMin: 6 * 60 })], PERIOD.from, PERIOD.to)[0];
      expect(r.overtimeHours).toBe(6);
    });
  });

  it("leaves the gap unstated when only one side reported", () => {
    // A missing figure is not a zero. "0" would read as "the two agree", which is
    // the one thing it does not mean.
    expect(buildClose([person({ clockedBalanceMin: null, payrollOtHours: 12 })], PERIOD.from, PERIOD.to)[0].deltaHours).toBeNull();
    expect(buildClose([person({ clockedBalanceMin: 600, payrollOtHours: null })], PERIOD.from, PERIOD.to)[0].deltaHours).toBeNull();
  });

  it("folds the two sources' spellings into one word each", () => {
    // TimeMoto says Vacation and Sickness; the manual marks say holiday and sick.
    const r = buildClose([person({
      absences: { Sickness: 2, sick: 1, Vacation: 3, holiday: 1, "Unpaid Leave": 2, "Jury Service": 1 },
    })], PERIOD.from, PERIOD.to)[0];
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
    ], PERIOD.from, PERIOD.to);
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
    ], PERIOD.from, PERIOD.to);
    expect(closeTotals(rows).unreconciled).toBe(2);
  });

  it("sums each side separately and never merges them", () => {
    const rows = buildClose([
      person({ employeeId: "a", clockedBalanceMin: 60 * 10, payrollOtHours: 15 }),
      person({ employeeId: "b", clockedBalanceMin: 60 * 4, payrollOtHours: 4 }),
    ], PERIOD.from, PERIOD.to);
    const t = closeTotals(rows);
    expect(t.clockedOtHours).toBe(14);
    expect(t.payrollOtHours).toBe(19);
    expect(t.deltaHours).toBe(5);
    expect(t.people).toBe(2);
  });
});

describe("the export finance receives", () => {
  it("has a column for every header", () => {
    const rows = buildClose([person({ clockedBalanceMin: 90, payrollOtHours: 2, daysPresent: 4 })], PERIOD.from, PERIOD.to);
    expect(closeToCsvRows(rows)[0]).toHaveLength(CLOSE_HEADERS.length);
  });

  it("leaves a cell blank rather than writing a zero nobody reported", () => {
    const rows = buildClose([person({ clockedBalanceMin: null, payrollOtHours: null })], PERIOD.from, PERIOD.to);
    const [row] = closeToCsvRows(rows);
    // Opening is known — it is zero, not missing — so it stays a number. Everything
    // downstream of the clocks is blank, because nothing was reported to derive it.
    //
    // Found by header name rather than by a hard-coded index: adding the Shift column
    // shifted every one of these by one, and a test that knows the position of
    // "Opening bank" only tells you the count changed, not what moved.
    const at = (header: string) => row[CLOSE_HEADERS.indexOf(header)];
    expect(at("Opening bank (h)")).toBe(0);
    for (const h of [
      "Period balance (h)", "Closing bank (h)", "Overtime paid (h)",
      "Hours owed (h)", "Payroll OT (h)", "Delta (h)",
    ]) expect(at(h)).toBe("");
  });

  it("names the shift beside the person", () => {
    const [day] = closeToCsvRows(buildClose([person({ shift: "Night" })], PERIOD.from, PERIOD.to));
    expect(day[CLOSE_HEADERS.indexOf("Shift")]).toBe("Night");
    // Nobody's crew on file is blank, not a guess at "Day".
    const [none] = closeToCsvRows(buildClose([person({ shift: null })], PERIOD.from, PERIOD.to));
    expect(none[CLOSE_HEADERS.indexOf("Shift")]).toBe("");
  });
});

describe("closeTotals across people", () => {
  it("never nets one person's shortfall against another's overtime", () => {
    // They are paid separately and owe separately. Netting would show a factory in
    // balance while one person is owed ten hours and another owes ten.
    const t = closeTotals(buildClose([
      person({ employeeId: "a", clockedBalanceMin: 10 * 60 }),
      person({ employeeId: "b", clockedBalanceMin: -10 * 60 }),
    ], PERIOD.from, PERIOD.to));
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
    const r = buildClose([person({ openingBalanceMin: -16 * 60, clockedBalanceMin: 12 * 60 })], PERIOD.from, PERIOD.to)[0];
    expect(r.clockedOtHours).toBe(12);
    expect(r.closingHours).toBe(-4);
    expect(r.overtimeHours).toBe(0);
    expect(r.owedHours).toBe(4);
  });

  it("pays what is left once the bank is back above zero", () => {
    const r = buildClose([person({ openingBalanceMin: -4 * 60, clockedBalanceMin: 10 * 60 })], PERIOD.from, PERIOD.to)[0];
    expect(r.closingHours).toBe(6);
    expect(r.overtimeHours).toBe(6);
  });

  it("carries a surplus forward instead of losing it", () => {
    const r = buildClose([person({ openingBalanceMin: 5 * 60, clockedBalanceMin: 3 * 60 })], PERIOD.from, PERIOD.to)[0];
    expect(r.closingHours).toBe(8);
  });

  it("measures the payroll claim against the bank, not the period alone", () => {
    // Somebody twelve hours up inside a period but still four down overall has earned
    // nothing yet; a claim of twelve is twelve unsupported hours.
    const r = buildClose([person({
      openingBalanceMin: -16 * 60, clockedBalanceMin: 12 * 60, payrollOtHours: 12,
    })], PERIOD.from, PERIOD.to)[0];
    expect(r.deltaHours).toBe(12);
  });

  it("treats a missing history as zero without calling it settled", () => {
    const r = buildClose([person({ openingBalanceMin: null, clockedBalanceMin: 6 * 60 })], PERIOD.from, PERIOD.to)[0];
    expect(r.openingHours).toBe(0);
    expect(r.overtimeHours).toBe(6);
  });
});

describe("the board's answer, carried in the same row", () => {
  // Mon–Thu over 13/07–09/08 is sixteen shifts. The contract is 16 × 11 h = 176 h.
  const monThu = { patternName: "Mon–Thu days", patternDays: [1, 2, 3, 4] };

  it("counts what the rota called for across the period", () => {
    const [r] = buildClose([person({ ...monThu, shiftsWorked: 16 })], PERIOD.from, PERIOD.to);
    expect(r.shiftsDue).toBe(16);
    expect(r.shiftBalance).toBe(0);
  });

  it("takes booked holiday off what was owed, and nothing else", () => {
    // Only holiday reduces the requirement — the rule agreed, and not this file's to
    // change. Sickness and unpaid are counted and shown but do not reduce it.
    const [r] = buildClose(
      [person({ ...monThu, shiftsWorked: 14, shiftsHoliday: 2 })], PERIOD.from, PERIOD.to,
    );
    expect(r.shiftsDue).toBe(14);
    expect(r.shiftBalance).toBe(0);
  });

  it("shows shifts over the rota as a positive balance", () => {
    const [r] = buildClose([person({ ...monThu, shiftsWorked: 19 })], PERIOD.from, PERIOD.to);
    expect(r.shiftBalance).toBe(3);
  });

  it("never asks for negative work when a rota changed mid-period", () => {
    // More holiday than shifts due is a rota change, not a debt.
    const [r] = buildClose(
      [person({ ...monThu, shiftsWorked: 0, shiftsHoliday: 20 })], PERIOD.from, PERIOD.to,
    );
    expect(r.shiftsDue).toBe(0);
    expect(r.shiftBalance).toBe(0);
  });

  it("says nothing about somebody with no rota on file", () => {
    const [r] = buildClose([person({ shiftsWorked: 9 })], PERIOD.from, PERIOD.to);
    expect(r.shiftsDue).toBeNull();
    expect(r.shiftBalance).toBeNull();
  });

  it("keeps a board nobody planned out of the deficit", () => {
    // The night board went twenty-seven of this period's twenty-eight days unplanned.
    // Counted with everybody else that is forty-eight invented deficits burying the two
    // or three that are real.
    const t = closeTotals(buildClose([
      person({ employeeId: "a", ...monThu, shiftsWorked: 0, plannedDates: new Set() }),
      person({ employeeId: "b", ...monThu, shiftsWorked: 14, plannedDates: null }),
    ], PERIOD.from, PERIOD.to));
    expect(t.deficitShifts).toBe(2);
    // Counted, because a clean zero for somebody the board never covered is not the
    // same as somebody who worked their rota, and the close has to say which.
    expect(t.onUnplannedBoard).toBe(1);
  });

  it("does not let one planned day make a whole period count", () => {
    // The bug this replaced: `boardPlanned` was a boolean, and the thirty names on the
    // Night board on 07/08 flipped all forty-eight of that crew from excluded to a full
    // period short.
    const oneDay = new Set(["2026-08-07"]);
    const [r] = buildClose(
      [person({ ...monThu, shiftsWorked: 0, plannedDates: oneDay })], PERIOD.from, PERIOD.to,
    );
    // 07/08 is a Friday and Mon–Thu does not cover it, so nothing is due at all.
    expect(r.shiftsDue).toBe(0);
    expect(r.shiftBalance).toBe(0);
  });

  it("charges only the rostered days the board was actually filled in for", () => {
    // Mon–Thu over the period is sixteen shifts. If the board was planned on only four
    // of those days, four is what can be measured — the other twelve are a gap in the
    // record, not twelve absences.
    const four = new Set(["2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16"]);
    const [r] = buildClose(
      [person({ ...monThu, shiftsWorked: 3, plannedDates: four })], PERIOD.from, PERIOD.to,
    );
    expect(r.shiftsDue).toBe(4);
    expect(r.shiftBalance).toBe(-1);
  });

  it("never adds shifts to hours", () => {
    // Somebody who works every shift and goes home at two is LEVEL on shifts and SHORT
    // on hours. The two answer different questions and the row must say both.
    const [r] = buildClose([person({
      ...monThu, shiftsWorked: 16, clockedBalanceMin: -9 * 60, earlyLeaveHours: 9,
    })], PERIOD.from, PERIOD.to);
    expect(r.shiftBalance).toBe(0);
    expect(r.closingHours).toBe(-9);
    expect(r.owedHours).toBe(9);
  });

  it("exports the shift columns beside the hours", () => {
    const [row] = closeToCsvRows(buildClose(
      [person({ ...monThu, shiftsWorked: 18 })], PERIOD.from, PERIOD.to,
    ));
    const at = (h: string) => row[CLOSE_HEADERS.indexOf(h)];
    expect(at("Rota")).toBe("Mon–Thu days");
    expect(at("Shifts due")).toBe(16);
    expect(at("Shifts worked")).toBe(18);
    expect(at("Shifts +/−")).toBe(2);
  });
});
