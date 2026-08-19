import { describe, it, expect, vi } from "vitest";

/**
 * The Excel export is the same feature as the on-screen leader table, mailed around
 * instead of read on a screen — so it has to obey the same rule: a Health & Safety
 * near miss must never rank a leader. `generateQualityReportExcel`'s "By Leader"
 * block used to tally every row in `actions` with no domain filter, counting rows
 * instead of points, so a leader who filed several near misses could sort above one
 * who filed a single real quality action.
 *
 * `XLSX.writeFile` is intercepted (not the whole module — `book_new`/`utils` stay
 * real) so the test can read back the actual workbook that would have been saved,
 * instead of testing an internal helper the fix might stop using.
 */

const capturedBooks: unknown[] = [];

vi.mock("xlsx-js-style", async () => {
  const actual: any = await vi.importActual("xlsx-js-style");
  const base = actual.default ?? actual;
  return {
    default: {
      ...base,
      writeFile: (wb: unknown) => { capturedBooks.push(wb); },
    },
  };
});

import XLSX from "xlsx-js-style";
import { generateQualityReportExcel, type QualityReportAction } from "@/lib/qualityReport";

// `status` stays on the fixture on purpose, set to a value that would be obvious in
// the output: nothing in the report may read it, and a fixture that omits it could not
// tell "not read" from "not present".
const base = {
  action_no: null, status: "complete", severity: "low", line: "Line 1", shift: "DAY",
  department: null, sku: null, batch: null, labels: [] as string[], description: null,
  validation_status: "validated", closed_at: null,
};

// Marcio: one quality action. Ailton: one quality action plus five safety near
// misses — exactly the behaviour the feature exists to encourage, and exactly what
// must not move his place in a leader ranking mailed to a manager.
const actions: QualityReportAction[] = [
  { ...base, recorded_at: "2026-08-01", leader_name: "Marcio", domain: "quality" },
  { ...base, recorded_at: "2026-08-01", leader_name: "Ailton", domain: "quality" },
  ...Array.from({ length: 5 }, (_, i) => ({
    ...base, recorded_at: `2026-08-0${i + 2}`, leader_name: "Ailton", domain: "safety",
    severity: null, validation_status: "open",
  })),
];

// Not `sheet_to_json`: xlsx-js-style's styled header cells carry `v`/`s` but no
// `t`, which `sheet_to_json` silently reads as an empty row. Read the raw grid by
// cell address instead, which is what actually ends up in the saved file.
function summaryGrid(ws: any): (string | number | undefined)[][] {
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const grid: (string | number | undefined)[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: (string | number | undefined)[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      row.push(ws[XLSX.utils.encode_cell({ r, c })]?.v);
    }
    grid.push(row);
  }
  return grid;
}

function byLeaderRows(wb: any): [string, number][] {
  const grid = summaryGrid(wb.Sheets["Summary"]);
  const headIdx = grid.findIndex((r) => r[0] === "By Leader");
  const rows: [string, number][] = [];
  for (let i = headIdx + 1; i < grid.length && grid[i][0] !== undefined; i++) {
    rows.push([String(grid[i][0]), Number(grid[i][1])]);
  }
  return rows;
}

describe("generateQualityReportExcel — By Leader block", () => {
  it("does not count safety rows, so a leader's near misses cannot outrank real quality actions", () => {
    capturedBooks.length = 0;
    generateQualityReportExcel({ actions, periodLabel: "Aug 2026", generatedBy: "Test" });
    const rows = byLeaderRows(capturedBooks[capturedBooks.length - 1]);
    const ailton = rows.find(([name]) => name === "Ailton");
    // 1 quality action, not 1 + 5 safety near misses.
    expect(ailton?.[1]).toBe(1);
    // Tied with Marcio at 1 each — no inversion from raw safety volume.
    expect(rows.find(([name]) => name === "Marcio")?.[1]).toBe(1);
  });

  it("leaves the quality KPI totals on the Summary sheet unchanged (they already counted all rows)", () => {
    capturedBooks.length = 0;
    generateQualityReportExcel({ actions, periodLabel: "Aug 2026", generatedBy: "Test" });
    const ws = (capturedBooks[capturedBooks.length - 1] as any).Sheets["Summary"];
    const grid = summaryGrid(ws);
    const total = grid.find((r) => r[0] === "Total actions");
    expect(total?.[1]).toBe(actions.length);
  });
});

/**
 * The report used to count and print To do / In progress / Complete.
 *
 * Nothing writes `status` any more — an action is logged because it already happened,
 * so there is no "not started" for it to be in, and every new row now carries only the
 * column's default. A KPI counting that would have shown a backlog growing with every
 * action ever logged, on a document that gets signed and filed.
 *
 * What it counts instead is the state an audit asks about: has Quality ruled on this.
 */
describe("generateQualityReportExcel — the lifecycle it reports", () => {
  const grid = () => {
    capturedBooks.length = 0;
    generateQualityReportExcel({ actions, periodLabel: "Aug 2026", generatedBy: "Test" });
    return summaryGrid((capturedBooks[capturedBooks.length - 1] as any).Sheets["Summary"]);
  };
  const cells = (g: (string | number | undefined)[][]) =>
    g.flat().filter((v) => typeof v === "string") as string[];

  it("names no board state anywhere on the Summary sheet", () => {
    const found = cells(grid()).filter((v) => ["To do", "In progress", "Complete", "By Status"].includes(v));
    expect(found).toEqual([]);
  });

  it("counts the validation lifecycle instead", () => {
    const g = grid();
    // Two validated quality actions, five safety rows still open.
    expect(g.find((r) => r[0] === "Validated")?.[1]).toBe(2);
    expect(g.find((r) => r[0] === "Awaiting verdict")?.[1]).toBe(5);
    expect(g.find((r) => r[0] === "Rejected")?.[1]).toBe(0);
  });

  it("breaks the period down By Validation", () => {
    expect(cells(grid())).toContain("By Validation");
  });

  it("puts Validation where the Actions sheet used to put Status", () => {
    capturedBooks.length = 0;
    generateQualityReportExcel({ actions, periodLabel: "Aug 2026", generatedBy: "Test" });
    const g = summaryGrid((capturedBooks[capturedBooks.length - 1] as any).Sheets["Actions"]);
    expect(g[0][2]).toBe("Validation");
    // The fixture's status is "complete"; the column must show the verdict instead.
    expect(g[1][2]).toBe("Validated");
  });
});

/**
 * A printed column that is blank on most of its rows is not neutral: it takes width
 * from the one column a reader actually needs (Notes, truncated and wrapping), and it
 * makes a signed document look like a form nobody finished filling in.
 *
 * On the 19/08/2026 report — 69 actions across three months — `Action #` was blank on
 * 49 rows (only the 20 rows imported from the old Excel carry a number; the log form
 * does not require one) and `Severity` printed an em dash on 46 (the grade is a
 * judgement the form leaves optional). Two of the eleven columns were mostly nothing.
 *
 * The rule is per period, not per column-forever: import a spreadsheet that carries
 * action numbers and the column has to come back on its own, because then it says
 * something. So this is decided from the rows being printed, not from a constant.
 */
import { qualityDetailTable } from "@/lib/qualityReport";

describe("qualityDetailTable — a column has to earn its width", () => {
  const row = (over: Partial<QualityReportAction> = {}): QualityReportAction => ({
    ...base, recorded_at: "2026-08-13", leader_name: "Everton", domain: "quality",
    action_no: null, severity: null, ...over,
  });

  it("drops Action # when not one row in the period carries a number", () => {
    const { head } = qualityDetailTable([row(), row()]);
    expect(head).not.toContain("Action #");
  });

  it("drops Severity when no action in the period was graded", () => {
    const { head } = qualityDetailTable([row(), row()]);
    expect(head).not.toContain("Severity");
  });

  it("keeps Action # as soon as a single row has one, and puts it in that row's cell", () => {
    const { head, body } = qualityDetailTable([row(), row({ action_no: "AC-6179" })]);
    expect(head).toContain("Action #");
    expect(body[1][head.indexOf("Action #")]).toBe("AC-6179");
  });

  it("keeps Severity as soon as a single action is graded", () => {
    const { head, body } = qualityDetailTable([row(), row({ severity: "high" })]);
    expect(head).toContain("Severity");
    expect(body[1][head.indexOf("Severity")]).toBe("High");
  });

  it("treats a blank string the same as null — an imported empty cell is not data", () => {
    const { head } = qualityDetailTable([row({ action_no: "  ", severity: "" })]);
    expect(head).not.toContain("Action #");
    expect(head).not.toContain("Severity");
  });

  // `base` sets status: "complete" — the fixture carries the dead column on purpose.
  it("never prints a board state, whatever the dead status column says", () => {
    const { head, body } = qualityDetailTable([row()]);
    expect(head).not.toContain("Status");
    expect(body.flat()).not.toContain("Complete");
  });

  it("always keeps the columns that identify the action", () => {
    const { head } = qualityDetailTable([row()]);
    expect(head).toEqual(["Date", "Validation", "Line", "Shift", "Leader", "Dept", "SKU", "Batch", "Notes"]);
  });
});
