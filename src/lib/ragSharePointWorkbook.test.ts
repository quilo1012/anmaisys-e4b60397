import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseSharePointRagWorkbook, diffPlans, buildPlanUpdates, buildNewRowInserts, lineKey,
  WorkbookShapeError,
  type ExistingRow,
} from "./ragSharePointWorkbook";

const DAY_COL = (d: number) => 2 + 4 * d; // 0-based: Mon C, Tue G, …
const BLOCK_ROWS = [2, 23, 44, 65, 86, 107, 128, 149];

interface Block {
  line: string;
  dates: (Date | null)[];
  /** [day, night] plan per weekday; undefined = blank cell */
  plan: ([number | null, number | null] | undefined)[];
}

function sheetFor(blocks: Block[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxR = 0, maxC = 0;
  const put = (r1: number, c0: number, cell: XLSX.CellObject) => {
    ws[XLSX.utils.encode_cell({ r: r1 - 1, c: c0 })] = cell;
    maxR = Math.max(maxR, r1 - 1); maxC = Math.max(maxC, c0);
  };
  blocks.forEach((b, i) => {
    const bs = BLOCK_ROWS[i];
    put(bs + 3, 1, { t: "s", v: b.line });
    for (let d = 0; d < 7; d++) {
      const col = DAY_COL(d);
      const date = b.dates[d];
      if (date) put(bs + 2, col, { t: "d", v: date });
      const p = b.plan[d];
      if (p) {
        if (p[0] != null) put(bs + 4, col, { t: "n", v: p[0] });
        if (p[1] != null) put(bs + 4, col + 1, { t: "n", v: p[1] });
      }
      // Derived Total / Yield columns that must never be read.
      put(bs + 4, col + 2, { t: "n", v: 999999 });
      put(bs + 5, col, { t: "n", v: 12345 }); // Actual row — never read
    }
    // "Progressive week to date": numbers to the right with no date above them.
    put(bs + 4, 40, { t: "n", v: 555555 });
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return ws;
}

function bookOf(sheets: { name: string; ws: XLSX.WorkSheet }[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, s.ws, s.name);
  return XLSX.write(wb, { type: "array", bookType: "xlsx", cellDates: true }) as ArrayBuffer;
}

const WEEK = [
  new Date(2026, 8, 1), new Date(2026, 8, 2), new Date(2026, 8, 3), new Date(2026, 8, 4),
  new Date(2026, 8, 5), new Date(2026, 8, 6), new Date(2026, 8, 7),
];
const DB_LINES = ["Line 1", "Tablet Line"];

function fixture() {
  const l1: Block = {
    line: "Line 1",
    dates: WEEK,
    plan: [[1000, 800], [1200, null], undefined, undefined, undefined, undefined, undefined],
  };
  const tablets: Block = {
    line: "Tablet line", // the file's spelling
    dates: WEEK,
    plan: [[500, 0], undefined, undefined, undefined, undefined, undefined, undefined],
  };
  const unknown: Block = {
    line: "Line 99",
    dates: WEEK,
    plan: [[111, 222], undefined, undefined, undefined, undefined, undefined, undefined],
  };
  return bookOf([
    { name: "Sheet1", ws: sheetFor([{ line: "junk", dates: [], plan: [] }]) },
    { name: "WC 010926", ws: sheetFor([l1, tablets, unknown]) },
  ]);
}

describe("SharePoint RAG workbook reader", () => {
  it("reads plan positionally for both shifts", () => {
    const r = parseSharePointRagWorkbook(fixture(), DB_LINES);
    const by = new Map(r.plans.map((p) => [`${p.entry_date}|${p.line}|${p.shift}`, p.plan_qty]));
    expect(by.get("2026-09-01|Line 1|DAY")).toBe(1000);
    expect(by.get("2026-09-01|Line 1|NIGHT")).toBe(800);
    expect(by.get("2026-09-02|Line 1|DAY")).toBe(1200);
  });

  it("treats a blank plan cell as 0", () => {
    const r = parseSharePointRagWorkbook(fixture(), DB_LINES);
    const night = r.plans.find((p) => p.entry_date === "2026-09-02" && p.shift === "NIGHT" && p.line === "Line 1")!;
    expect(night.plan_qty).toBe(0);
  });

  it("uses the database spelling of the line", () => {
    const r = parseSharePointRagWorkbook(fixture(), DB_LINES);
    expect(r.plans.some((p) => p.line === "Tablet Line")).toBe(true);
    expect(r.plans.some((p) => p.line === "Tablet line")).toBe(false);
  });

  it("skips a line it does not know instead of inventing rows", () => {
    const r = parseSharePointRagWorkbook(fixture(), DB_LINES);
    expect(r.unrecognisedLines).toEqual(["Line 99"]);
    expect(r.plans.every((p) => DB_LINES.includes(p.line))).toBe(true);
  });

  it("ignores non-WC sheets and undated columns", () => {
    const r = parseSharePointRagWorkbook(fixture(), DB_LINES);
    expect(r.sheets.map((s) => s.name)).toEqual(["WC 010926"]);
    expect(r.plans.every((p) => p.plan_qty !== 999999 && p.plan_qty !== 555555)).toBe(true);
    expect(r.dateRange).toEqual({ from: "2026-09-01", to: "2026-09-07" });
  });

  it("lets the last sheet win and says so", () => {
    const week1: Block = { line: "Line 1", dates: WEEK, plan: [[100, 100]] };
    const week1again: Block = { line: "Line 1", dates: WEEK, plan: [[700, 100]] };
    const buf = bookOf([
      { name: "WC 010926", ws: sheetFor([week1]) },
      { name: "WC 070926", ws: sheetFor([week1again]) },
    ]);
    const r = parseSharePointRagWorkbook(buf, DB_LINES);
    const mon = r.plans.find((p) => p.entry_date === "2026-09-01" && p.shift === "DAY")!;
    expect(mon.plan_qty).toBe(700);
    expect(r.overlappingKeys).toContain("2026-09-01|Line 1|DAY");
  });

  it("explains a workbook with no WC sheets", () => {
    const buf = bookOf([{ name: "Sheet1", ws: sheetFor([{ line: "x", dates: [], plan: [] }]) }]);
    expect(() => parseSharePointRagWorkbook(buf, DB_LINES)).toThrow(WorkbookShapeError);
  });

  it("explains a file that is not a workbook", () => {
    expect(() => parseSharePointRagWorkbook(new TextEncoder().encode("not excel"), DB_LINES))
      .toThrow(WorkbookShapeError);
  });

  it("folds case and punctuation when matching lines", () => {
    expect(lineKey("Tablet line")).toBe(lineKey("Tablet Line"));
    expect(lineKey("Capsules & Tablets")).toBe(lineKey("capsules and tablets"));
  });
});

const row = (o: Partial<ExistingRow>): ExistingRow => ({
  id: "id-1", entry_date: "2026-09-01", line: "Line 1", shift: "DAY",
  plan_qty: 900, actual_qty: 850, upm_target: 60, upm_actual: 57,
  downtime_min: 30, notes: "kept", actual_source: "intouch", ...o,
});

describe("diff and payload", () => {
  it("separates changes, new rows and unchanged", () => {
    const plans = parseSharePointRagWorkbook(fixture(), DB_LINES).plans;
    const existing = [
      row({}), // plan 900 vs 1000 → change
      row({ id: "id-2", shift: "NIGHT", plan_qty: 800 }), // equal → unchanged
    ];
    const d = diffPlans(plans, existing);
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0].currentPlan).toBe(900);
    expect(d.changes[0].filePlan).toBe(1000);
    expect(d.changes[0].actual).toBe(850);
    expect(d.unchanged).toBe(1);
    expect(d.newRows.some((n) => n.entry_date === "2026-09-02" && n.shift === "DAY")).toBe(true);
    // zero-plan cells with no stored row create nothing
    expect(d.newRows.some((n) => n.filePlan === 0)).toBe(false);
    expect(d.skippedEmpty).toBeGreaterThan(0);
  });

  it("sends the id, plan and UPM target only, so a newer actual cannot be overwritten", () => {
    const d = diffPlans(
      [{ entry_date: "2026-09-01", line: "Line 1", shift: "DAY", plan_qty: 1000, upm_target: null, sheet: "WC 010926" }],
      [row({})],
    );
    const updates = buildPlanUpdates(d.changes);
    expect(updates).toEqual([{ id: "id-1", plan_qty: 1000, upm_target: null }]);
    // No snapshot column, no upm_actual, and no hand-set updated_at.
    expect(Object.keys(updates[0]).sort()).toEqual(["id", "plan_qty", "upm_target"]);
  });

  it("carries the UPM target when the file states one, and leaves it alone when blank", () => {
    const stored = row({ upm_target: 120 } as any);
    const same = diffPlans(
      [{ entry_date: "2026-09-01", line: "Line 1", shift: "DAY", plan_qty: 900, upm_target: 120, sheet: "s" }],
      [stored],
    );
    expect(same.changes).toHaveLength(0);

    const moved = diffPlans(
      [{ entry_date: "2026-09-01", line: "Line 1", shift: "DAY", plan_qty: 900, upm_target: 150, sheet: "s" }],
      [stored],
    );
    expect(moved.changes).toHaveLength(1);
    expect(buildPlanUpdates(moved.changes)[0]).toEqual({ id: "id-1", plan_qty: 900, upm_target: 150 });

    const blank = diffPlans(
      [{ entry_date: "2026-09-01", line: "Line 1", shift: "DAY", plan_qty: 1000, upm_target: null, sheet: "s" }],
      [stored],
    );
    expect(buildPlanUpdates(blank.changes)[0].upm_target).toBeNull();
  });

  it("inserts new rows with the plan and UPM target, and nothing measured", () => {
    const d = diffPlans(
      [{ entry_date: "2026-09-08", line: "Line 1", shift: "DAY", plan_qty: 400, upm_target: 90, sheet: "s" }],
      [],
    );
    const inserts = buildNewRowInserts(d.newRows);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual({
      entry_date: "2026-09-08", line: "Line 1", shift: "DAY", plan_qty: 400, upm_target: 90,
    });
    // Defaults belong to the table, not the client — and upm_actual is measured here.
    for (const col of ["actual_qty", "upm_actual", "downtime_min", "notes", "actual_source", "updated_at"]) {
      expect(inserts[0]).not.toHaveProperty(col);
    }
  });

  it("keeps each payload uniform so each can be one batched write", () => {
    const d = diffPlans(
      [
        { entry_date: "2026-09-01", line: "Line 1", shift: "DAY", plan_qty: 1000, upm_target: null, sheet: "s" },
        { entry_date: "2026-09-08", line: "Line 1", shift: "DAY", plan_qty: 400, upm_target: null, sheet: "s" },
      ],
      [row({}), row({ id: "id-2", entry_date: "2026-09-08", plan_qty: 100 })],
    );
    const updates = buildPlanUpdates(d.changes);
    expect(updates).toHaveLength(2);
    expect(new Set(updates.map((u) => Object.keys(u).sort().join(","))).size).toBe(1);
    expect(buildNewRowInserts(d.newRows)).toHaveLength(0);
  });
});
