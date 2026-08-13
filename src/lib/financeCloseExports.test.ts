import { describe, it, expect, vi } from "vitest";
import XLSX from "xlsx-js-style";
import type { WorkBook, Range, CellObject } from "xlsx-js-style";
import { buildClose, closeTotals, type ClosePersonInput, type ClosePerson } from "@/lib/financeClose";
import { CLOSE_COLUMNS } from "@/lib/financeCloseColumns";
import {
  buildClosePdf, buildCloseWorkbook, closeSubtitle, closeWarningText,
  type CloseExportInput,
} from "@/lib/financeCloseExports";

const PERIOD = { from: "2026-08-10", to: "2026-09-06" };

const person = (over: Partial<ClosePersonInput> = {}): ClosePersonInput => ({
  employeeId: "e1", name: "Ana Silva", department: "Production", shift: "Weekend",
  partDayHours: 0, patternName: "Fri–Mon", patternDays: [5, 6, 7, 1],
  shiftsWorked: 14, shiftsHoliday: 0, plannedDates: null,
  openingBalanceMin: 0, clockedBalanceMin: 0, payrollOtHours: 0,
  absences: {}, daysPresent: 10, ...over,
});

function input(over: Partial<CloseExportInput> = {}): CloseExportInput {
  const rows = buildClose(
    [
      person(),
      person({ employeeId: "e2", name: "Bruno Costa", department: "Hygiene", clockedBalanceMin: 720 }),
      person({ employeeId: "e3", name: "Carla Dias", department: null, shift: null, clockedBalanceMin: null, payrollOtHours: null }),
    ],
    PERIOD.from, PERIOD.to,
  );
  const totals = closeTotals(rows);
  return {
    periodName: "August 2026", from: PERIOD.from, to: PERIOD.to,
    scope: "Production · Weekend",
    rows, totals,
    byCrew: [{ crew: "Weekend", totals }],
    fileBase: "finance-close-august-2026-production-weekend",
    ...over,
  };
}

type Cell = string | number | null;
const sheetAoa = (wb: WorkBook, name: string): Cell[][] =>
  XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, defval: null });

/**
 * The sentence that must leave the building with the numbers.
 *
 * Two hundred hours went unreconciled because two disagreeing sources were read as one.
 * A sheet of eighteen columns that does not say Payroll OT and Overtime are never added
 * is the same failure, printed.
 */
describe("the warning that travels with the figures", () => {
  it("says the balance runs on and that the two sources are never added", () => {
    const w = closeWarningText(closeTotals(input().rows));
    expect(w).toMatch(/hour bank/i);
    expect(w).toMatch(/never added together/i);
    expect(w).toMatch(/reported nothing, which is not zero/i);
  });

  it("says out loud when nothing has been keyed, because a 0.00 gap reads as agreement", () => {
    const rows = buildClose([person({ payrollOtHours: null })], PERIOD.from, PERIOD.to);
    expect(closeWarningText(closeTotals(rows)))
      .toMatch(/No payroll overtime has been keyed for this period at all/);
  });

  it("counts the people reported on one side only", () => {
    const rows = buildClose(
      [person({ payrollOtHours: 4 }), person({ employeeId: "e2", name: "B", clockedBalanceMin: null })],
      PERIOD.from, PERIOD.to,
    );
    expect(closeWarningText(closeTotals(rows))).toMatch(/1 person has a figure on one side only/);
  });
});

describe("the subtitle both formats carry", () => {
  it("names the period and the filter, so a printed sheet says what it covers", () => {
    expect(closeSubtitle(input())).toContain("August 2026");
    expect(closeSubtitle(input())).toContain("Production · Weekend");
  });

  it("says so when nothing is filtered, rather than leaving the reader to assume", () => {
    expect(closeSubtitle({ ...input(), scope: "" })).toContain("Every crew, every department");
  });
});

/** The generator has to survive being run, not merely compile. */
describe("the PDF", () => {
  it("builds without throwing and produces at least one page", async () => {
    const doc = await buildClosePdf(input());
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it("is landscape, because eighteen columns do not fit a portrait page", async () => {
    const doc = await buildClosePdf(input());
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight());
  });

  it("builds for an empty close rather than throwing at whoever filtered to nobody", async () => {
    const doc = await buildClosePdf({ ...input(), rows: [], byCrew: [] });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  /**
   * The columns have to fill the page, and autoTable only says so on the console.
   *
   * With every width fixed there is nothing elastic to absorb the slack, so 264 mm of
   * columns on a 269 mm page printed five millimetres narrow and logged "5 units width
   * could not fit page" — a message that reads like an overflow, means the opposite,
   * and which nobody would ever have seen. Asserted rather than eyeballed.
   */
  it("lays the columns out with no width left over and none overflowing", async () => {
    const complaints: unknown[][] = [];
    const spies = (["error", "warn", "log"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { complaints.push(a); }));
    try {
      await buildClosePdf(input());
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    const fit = complaints.flat().filter(
      (m) => typeof m === "string" && /could not fit page/i.test(m),
    );
    expect(fit).toEqual([]);
  });
});

/**
 * The workbook payroll adds up.
 *
 * These assertions are the whole reason the Excel export exists rather than a second
 * CSV: numbers that are numbers, and empty cells where a side reported nothing.
 */
describe("the workbook", () => {
  it("carries the three sheets in the order finance reads them", () => {
    expect(buildCloseWorkbook(input()).SheetNames).toEqual(["Summary", "By crew", "People"]);
  });

  it("bands the People sheet over the column names, covering every column", () => {
    const wb = buildCloseWorkbook(input());
    const aoa = sheetAoa(wb, "People");
    expect(aoa[0].length).toBe(CLOSE_COLUMNS.length);
    expect(aoa[1]).toEqual(CLOSE_COLUMNS.map((c) => c.header));
    // The band the screen used to get wrong: Payroll OT must not sit under "Days away".
    const payrollAt = CLOSE_COLUMNS.findIndex((c) => c.key === "payrollOtHours");
    const merges: Range[] = wb.Sheets["People"]["!merges"] ?? [];
    const band = merges.find((m) => m.s.c <= payrollAt && m.e.c >= payrollAt);
    expect(aoa[0][band.s.c]).toBe("Hours · from the clocks");
  });

  it("hands over hours as numbers, so the column can be summed", () => {
    const aoa = sheetAoa(buildCloseWorkbook(input()), "People");
    const at = CLOSE_COLUMNS.findIndex((c) => c.key === "clockedOtHours");
    // By name, not by position: buildClose sorts by the size of the disagreement, so
    // the sheet's row order is not the order the people were assembled in.
    const bruno = aoa.find((r) => r[0] === "Bruno Costa")!;
    expect(bruno[at]).toBe(12); // 720 minutes
    expect(typeof bruno[at]).toBe("number");
  });

  it("leaves an unreported figure an EMPTY cell, never a zero and never a dash", () => {
    const wb = buildCloseWorkbook(input());
    const aoa = sheetAoa(wb, "People");
    const at = CLOSE_COLUMNS.findIndex((c) => c.key === "payrollOtHours");
    // Carla reported on neither side; Ana reported a genuine zero. The sheet has to
    // tell them apart, which is the entire reason this is not a second CSV.
    const carlaRow = aoa.findIndex((r) => r[0] === "Carla Dias");
    const anaRow = aoa.findIndex((r) => r[0] === "Ana Silva");
    expect(wb.Sheets["People"][XLSX.utils.encode_cell({ r: carlaRow, c: at })]).toBeUndefined();
    expect((wb.Sheets["People"][XLSX.utils.encode_cell({ r: anaRow, c: at })] as CellObject).v).toBe(0);
  });

  it("leaves the gap blank on the summary when nothing was keyed to compare", () => {
    const rows = buildClose([person({ payrollOtHours: null })], PERIOD.from, PERIOD.to);
    const totals = closeTotals(rows);
    const wb = buildCloseWorkbook({ ...input(), rows, totals, byCrew: [{ crew: "Weekend", totals }] });
    const summary = sheetAoa(wb, "Summary");
    const gap = summary.find((r) => r[0] === "Gap to settle");
    expect(gap![1]).toBeNull();
  });

  it("prints the warning on the summary, since a workbook is forwarded more than a printout", () => {
    const summary = sheetAoa(buildCloseWorkbook(input()), "Summary");
    expect(summary.some((r) => typeof r[0] === "string" && /hour bank/i.test(r[0]))).toBe(true);
  });

  it("gives the People sheet an autofilter over the names row and the rows below it", () => {
    const wb = buildCloseWorkbook(input());
    const { ref } = wb.Sheets["People"]["!autofilter"] as { ref: string };
    const range = XLSX.utils.decode_range(ref);
    expect(range.s.r).toBe(1);
    expect(range.e.r).toBe(1 + 3);
    expect(range.e.c).toBe(CLOSE_COLUMNS.length - 1);
  });

  it("builds for an empty close rather than throwing", () => {
    const rows: ClosePerson[] = [];
    const wb = buildCloseWorkbook({ ...input(), rows, totals: closeTotals(rows), byCrew: [] });
    expect(wb.SheetNames).toContain("People");
  });
});
