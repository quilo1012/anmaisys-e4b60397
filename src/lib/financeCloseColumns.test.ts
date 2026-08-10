import { describe, it, expect } from "vitest";
import { buildClose, type ClosePersonInput } from "@/lib/financeClose";
import {
  CLOSE_COLUMNS, closeBandSpans, closeExportValues, closeDisplayValues, BAND_LABELS,
} from "@/lib/financeCloseColumns";

const PERIOD = { from: "2026-07-13", to: "2026-08-09" };

const person = (over: Partial<ClosePersonInput> = {}): ClosePersonInput => ({
  employeeId: "e1", name: "Ana Silva", department: "Production", shift: "Weekend", earlyLeaveHours: 0,
  patternName: null, patternDays: null, shiftsWorked: 0, shiftsHoliday: 0, plannedDates: null,
  openingBalanceMin: 0, clockedBalanceMin: 0, payrollOtHours: 0, absences: {}, daysPresent: 0, ...over,
});
const one = (over: Partial<ClosePersonInput> = {}) =>
  buildClose([person(over)], PERIOD.from, PERIOD.to)[0];

const at = (row: unknown[], key: string) =>
  row[CLOSE_COLUMNS.findIndex((c) => c.key === key)];

/**
 * The bands over the columns.
 *
 * The screen wrote them by hand as colSpan 3 + 3 + 5 + 5 — sixteen, over a table of
 * eighteen. Everything past the tenth column sat a band too far left, so Payroll OT and
 * Δ were printed under "Days away": hours labelled as days of absence, on the document
 * finance pays from. Counting them off the columns is what makes that impossible.
 */
describe("the bands over the close", () => {
  it("covers every column exactly once", () => {
    const total = closeBandSpans().reduce((n, b) => n + b.span, 0);
    expect(total).toBe(CLOSE_COLUMNS.length);
  });

  it("keeps Payroll OT and the delta with the hours, not with the days away", () => {
    const bandOf = (key: string) => CLOSE_COLUMNS.find((c) => c.key === key)!.band;
    expect(bandOf("payrollOtHours")).toBe("clockedHours");
    expect(bandOf("deltaHours")).toBe("clockedHours");
    expect(bandOf("sick")).toBe("daysAway");
  });

  it("keeps the early-leave hours out of the clocked band, because the board is its source", () => {
    // Reported apart for the reason financeClose.ts labours: adding a board figure to a
    // clocked one counts the same missing hours twice once TimeMoto is imported.
    expect(CLOSE_COLUMNS.find((c) => c.key === "earlyLeaveHours")!.band).toBe("boardHours");
    expect(BAND_LABELS.boardHours).toBe("Hours · from the board");
    expect(BAND_LABELS.clockedHours).toBe("Hours · from the clocks");
  });

  it("gives the naming columns no band, so the header does not label a name as a figure", () => {
    expect(closeBandSpans()[0]).toEqual({ band: "who", label: null, span: 3 });
  });

  it("never merges two bands that happen to sit side by side", () => {
    const bands = closeBandSpans().map((b) => b.band);
    expect(new Set(bands).size).toBe(bands.length);
  });
});

/**
 * What the spreadsheet gets.
 *
 * Payroll sums these columns. A dash that arrives as the string "—" is not summable,
 * and a null that arrives as 0 says the clocks reported a zero when they reported
 * nothing at all — the one confusion this whole screen was built to prevent.
 */
describe("the values Excel receives", () => {
  it("hands over numbers, not formatted text", () => {
    const r = one({ clockedBalanceMin: 450, shiftsWorked: 3 });
    expect(at(closeExportValues(r), "clockedOtHours")).toBe(7.5);
    expect(at(closeExportValues(r), "shiftsWorked")).toBe(3);
  });

  it("leaves an unreported figure null rather than turning it into zero", () => {
    const r = one({ clockedBalanceMin: null, payrollOtHours: null });
    expect(at(closeExportValues(r), "clockedOtHours")).toBeNull();
    expect(at(closeExportValues(r), "payrollOtHours")).toBeNull();
    expect(at(closeExportValues(r), "deltaHours")).toBeNull();
  });

  it("keeps a real zero as zero, because nothing owed is not nothing reported", () => {
    const r = one({ clockedBalanceMin: 0 });
    expect(at(closeExportValues(r), "owedHours")).toBe(0);
    expect(at(closeExportValues(r), "sick")).toBe(0);
  });
});

/** What the printed page shows — the screen's own conventions, on paper. */
describe("the values the PDF prints", () => {
  it("prints a dash for anything unreported", () => {
    const r = one({ clockedBalanceMin: null, payrollOtHours: null });
    expect(at(closeDisplayValues(r), "clockedOtHours")).toBe("—");
    expect(at(closeDisplayValues(r), "deltaHours")).toBe("—");
  });

  it("quietens the zeros the screen quietens, and only those", () => {
    const r = one({ clockedBalanceMin: 0 });
    expect(at(closeDisplayValues(r), "sick")).toBe("—");
    expect(at(closeDisplayValues(r), "owedHours")).toBe("—");
    // Present is a count somebody reads as a count; a zero there is information.
    expect(at(closeDisplayValues(r), "daysPresent")).toBe("0");
  });

  it("signs the shift balance, because +2 and 2 read differently to somebody paying", () => {
    const over = one({ patternDays: [1, 2, 3, 4], shiftsWorked: 18 });
    expect(at(closeDisplayValues(over), "shiftBalance")).toMatch(/^\+/);
    const under = one({ patternDays: [1, 2, 3, 4], shiftsWorked: 2 });
    expect(String(at(closeDisplayValues(under), "shiftBalance"))).toMatch(/^-/);
  });

  it("gives hours two decimals and shifts none", () => {
    const r = one({ clockedBalanceMin: 450, shiftsWorked: 3 });
    expect(at(closeDisplayValues(r), "clockedOtHours")).toBe("7.50");
    expect(at(closeDisplayValues(r), "shiftsWorked")).toBe("3");
  });

  it("dashes a missing name rather than printing an empty cell nobody can read", () => {
    const r = one({ shift: null, department: null });
    expect(at(closeDisplayValues(r), "shift")).toBe("—");
    expect(at(closeDisplayValues(r), "department")).toBe("—");
  });
});
