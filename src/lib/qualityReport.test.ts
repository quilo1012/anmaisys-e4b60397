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

const base = {
  action_no: null, status: "todo", severity: "low", line: "Line 1", shift: "DAY",
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
