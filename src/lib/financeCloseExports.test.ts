import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import { buildClose, closeTotals, type ClosePersonInput, type ClosePerson } from "@/lib/financeClose";
import { CLOSE_COLUMNS, pickPrintColumns } from "@/lib/financeCloseColumns";
import {
  buildClosePdf, buildCloseWorkbook, closeSubtitle, closeWarningText,
  type CloseExportInput,
} from "@/lib/financeCloseExports";

vi.mock("@/lib/financeReportFont", () => ({ loadFinanceReportFont: async () => undefined }));

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

/**
 * The workbook as Excel will open it: written to bytes and read back, so a test sees
 * what the file holds and not what the builder meant to put in it.
 */
async function roundTrip(i: CloseExportInput): Promise<ExcelJS.Workbook> {
  const built = await buildCloseWorkbook(i);
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(await built.xlsx.writeBuffer());
  return back;
}

/** A cell as data: a formula reads as its cached result, an empty cell as null. */
function plain(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (typeof v === "object" && "result" in v) return (v.result ?? null) as Cell;
  if (typeof v === "object" && "richText" in v) return v.richText.map((t) => t.text).join("");
  return v as Cell;
}

function sheetAoa(wb: ExcelJS.Workbook, name: string): Cell[][] {
  const ws = wb.getWorksheet(name)!;
  const out: Cell[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row: Cell[] = [];
    for (let c = 1; c <= ws.columnCount; c++) row.push(plain(ws.getCell(r, c).value));
    out.push(row);
  }
  return out;
}

/** The row holding the column names on the People sheet (the band row is above it). */
const headerRowIndex = (aoa: Cell[][]) => aoa.findIndex((r) => r[0] === "Employee");

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

/**
 * The figure that was not keeping to the convention its own warning states.
 *
 * `overtime_entries` is empty across all 29 periods — the office has never keyed a
 * payroll overtime hour, in any of them. The Δ already said "—" for that, and the
 * warning text already said "a dash means that side reported nothing, which is not
 * zero", but the Payroll OT figure itself printed `0.00`. On the document finance pays
 * from, that reads as overtime checked and found to be none, rather than as a column
 * nobody has ever filled in.
 */
describe("Payroll OT when the office has keyed nothing", () => {
  const empty = () => {
    const rows = buildClose([person({ payrollOtHours: null })], PERIOD.from, PERIOD.to);
    return { rows, totals: closeTotals(rows) };
  };

  it("knows the difference between nothing keyed and nothing owed", () => {
    expect(empty().totals.payrollEmpty).toBe(true);
    // A real zero is a measurement, and must not be mistaken for the absence of one.
    const zero = buildClose([person({ payrollOtHours: 0 })], PERIOD.from, PERIOD.to);
    expect(closeTotals(zero).payrollEmpty).toBe(false);
  });

  it("leaves the cell empty in the workbook rather than writing a nought", async () => {
    const wb = await roundTrip(input({ ...empty(), byCrew: [{ crew: "Weekend", totals: empty().totals }] }));
    const rows = sheetAoa(wb, "Summary");
    const line = rows.find((r) => r.some((c) => c === "Payroll OT"));
    expect(line).toBeDefined();
    // null, not 0 — a spreadsheet sums a nought and ignores a blank, and this figure
    // is one somebody will total a column of.
    expect(line!.some((c) => c === 0)).toBe(false);
  });

  it("still prints a real figure when one was keyed", () => {
    const rows = buildClose([person({ payrollOtHours: 4 })], PERIOD.from, PERIOD.to);
    const t = closeTotals(rows);
    expect(t.payrollEmpty).toBe(false);
    expect(t.payrollOtHours).toBe(4);
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
  it("carries the sheets in the order finance reads them", async () => {
    const wb = await roundTrip(input());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "People", "By crew", "Overtime register"]);
  });

  it("bands the People sheet over the column names, covering every column", async () => {
    const wb = await roundTrip(input());
    const aoa = sheetAoa(wb, "People");
    const h = headerRowIndex(aoa);
    expect(aoa[h]).toEqual(CLOSE_COLUMNS.map((c) => c.header));
    // The band the screen used to get wrong: Payroll OT must not sit under "Days away".
    const payrollAt = CLOSE_COLUMNS.findIndex((c) => c.key === "payrollOtHours");
    const bandStart = CLOSE_COLUMNS.findIndex((c) => c.band === "clockedHours");
    expect(aoa[h - 1][bandStart]).toBe("Hours · from the clocks");
    const ws = wb.getWorksheet("People")!;
    // Merged: the payroll column's band cell is the same cell as the band's first.
    expect(ws.getCell(h, payrollAt + 1).master.address).toBe(ws.getCell(h, bandStart + 1).address);
  });

  /**
   * The bug this file was changed for: the print settings narrowed the paper and the
   * PDF, and the workbook still came out with every column. What was ticked is what the
   * file carries — in the close's own order, with the bands counted off those columns.
   */
  it("carries ONLY the columns ticked in the print settings", async () => {
    const cols = pickPrintColumns(["name", "department", "overtimeHours", "owedHours", "sick"]);
    const wb = await roundTrip(input({ columns: cols }));
    const aoa = sheetAoa(wb, "People");
    const h = headerRowIndex(aoa);
    expect(aoa[h]).toEqual(["Employee", "Department", "Overtime", "Deducted", "Sick"]);
    expect(wb.getWorksheet("People")!.columnCount).toBe(5);
    // The band row is counted off the chosen columns, not the full eighteen.
    expect(aoa[h - 1][2]).toBe("Hours · from the clocks");
    expect(aoa[h - 1][4]).toBe("Days away");
    // And the values line up under those headers.
    const bruno = aoa.find((r) => r[0] === "Bruno Costa")!;
    expect(bruno[1]).toBe("Hygiene");
  });

  it("hands over hours as numbers, so the column can be summed", async () => {
    const aoa = sheetAoa(await roundTrip(input()), "People");
    const at = CLOSE_COLUMNS.findIndex((c) => c.key === "clockedOtHours");
    // By name, not by position: buildClose sorts by the size of the disagreement, so
    // the sheet's row order is not the order the people were assembled in.
    const bruno = aoa.find((r) => r[0] === "Bruno Costa")!;
    expect(bruno[at]).toBe(12); // 720 minutes
    expect(typeof bruno[at]).toBe("number");
  });

  it("leaves an unreported figure an EMPTY cell, never a zero and never a dash", async () => {
    const aoa = sheetAoa(await roundTrip(input()), "People");
    const at = CLOSE_COLUMNS.findIndex((c) => c.key === "payrollOtHours");
    // Carla reported on neither side; Ana reported a genuine zero. The sheet has to
    // tell them apart, which is the entire reason this is not a second CSV.
    expect(aoa.find((r) => r[0] === "Carla Dias")![at]).toBeNull();
    expect(aoa.find((r) => r[0] === "Ana Silva")![at]).toBe(0);
  });

  it("closes the register with live totals that follow the autofilter", async () => {
    const wb = await roundTrip(input());
    const ws = wb.getWorksheet("People")!;
    const aoa = sheetAoa(wb, "People");
    const totalRow = aoa.findIndex((r) => typeof r[0] === "string" && r[0].startsWith("Total"));
    expect(aoa[totalRow][0]).toBe("Total · 3 people");
    const at = CLOSE_COLUMNS.findIndex((c) => c.key === "clockedOtHours");
    const cell = ws.getCell(totalRow + 1, at + 1).value as ExcelJS.CellFormulaValue;
    expect(cell.formula).toMatch(/^SUBTOTAL\(109,/);
    expect(cell.result).toBe(12);
  });

  it("leaves the gap blank on the summary when nothing was keyed to compare", async () => {
    const rows = buildClose([person({ payrollOtHours: null })], PERIOD.from, PERIOD.to);
    const totals = closeTotals(rows);
    const wb = await roundTrip({ ...input(), rows, totals, byCrew: [{ crew: "Weekend", totals }] });
    const gap = sheetAoa(wb, "Summary").find((r) => r[0] === "Gap to settle");
    expect(gap![1]).toBeNull();
  });

  it("prints the warning on the summary, since a workbook is forwarded more than a printout", async () => {
    const summary = sheetAoa(await roundTrip(input()), "Summary");
    expect(summary.some((r) => typeof r[0] === "string" && /hour bank/i.test(r[0]))).toBe(true);
  });

  it("freezes the names, filters the header row and repeats it on every printed page", async () => {
    const wb = await roundTrip(input());
    const ws = wb.getWorksheet("People")!;
    const h = headerRowIndex(sheetAoa(wb, "People")) + 1;
    expect(ws.views[0]).toMatchObject({ state: "frozen", xSplit: 1, ySplit: h });
    expect(String(ws.autoFilter)).toContain(`A${h}`);
    expect(ws.pageSetup.printTitlesRow).toBe(`${h - 1}:${h}`);
    expect(ws.pageSetup.fitToWidth).toBe(1);
  });

  it("turns the paper the same way as the printed sheet", async () => {
    const narrow = await roundTrip(input({ columns: pickPrintColumns(["name", "overtimeHours"]) }));
    expect(narrow.getWorksheet("People")!.pageSetup.orientation).toBe("portrait");
    const wide = await roundTrip(input());
    expect(wide.getWorksheet("People")!.pageSetup.orientation).toBe("landscape");
  });

  it("shows whole days as whole numbers, not with a trailing point", async () => {
    const ws = (await roundTrip(input())).getWorksheet("People")!;
    const at = CLOSE_COLUMNS.findIndex((c) => c.key === "daysPresent");
    expect(ws.getCell(10, at + 1).numFmt ?? "General").toBe("General");
  });

  it("says person, not people, for a close of one", async () => {
    const rows = buildClose([person()], PERIOD.from, PERIOD.to);
    const wb = await roundTrip({ ...input(), rows, totals: closeTotals(rows) });
    expect(sheetAoa(wb, "People").some((r) => r[0] === "Total · 1 person")).toBe(true);
  });

  it("does not merge the title across a single column when only the name is ticked", async () => {
    const wb = await roundTrip(input({ columns: pickPrintColumns([]) }));
    const ws = wb.getWorksheet("People")!;
    expect(ws.getCell("A1").isMerged).toBe(false);
    expect(sheetAoa(wb, "People").some((r) => r[0] === "Employee")).toBe(true);
  });

  it("builds for an empty close rather than throwing", async () => {
    const rows: ClosePerson[] = [];
    const wb = await roundTrip({ ...input(), rows, totals: closeTotals(rows), byCrew: [] });
    expect(wb.getWorksheet("People")).toBeDefined();
  });
});

describe("a period still running", () => {
  it("prints the period's own dates and says where the counting stopped", () => {
    // The screen opens on the period covering today. Printing 07/09 as the period's end
    // would say the period is one day long; printing 11/10 alone would say the figures
    // cover twenty-six days nobody has worked yet. The sheet has to say both.
    const s = closeSubtitle({
      periodName: "September 2026", from: "2026-09-07", to: "2026-10-11",
      countedTo: "2026-09-07", scope: "",
    });
    expect(s).toContain("07/09/2026 → 11/10/2026");
    expect(s).toContain("counted to 07/09/2026");
  });

  it("says nothing extra once the period has closed", () => {
    const s = closeSubtitle({
      periodName: "August 2026", from: "2026-08-10", to: "2026-09-06",
      countedTo: "2026-09-06", scope: "",
    });
    expect(s).not.toContain("counted to");
  });
});
