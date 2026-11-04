import { describe, expect, it } from "vitest";
import { parseItouchNumber, parseProductDetails, rejectedCyclesCsv, summariseCycles, toImportRows } from "./itouchCycleImport";
import { cleanCycles } from "./smartTargetRates";

// The header exactly as iTouch's Product Details export writes it, trailing spaces included.
const HEADER = [
  "UI", "SKU", "Description", "Part Weight ", "Material", "Machine", "Cavities ", "Tool Number",
  "Standard Cycle Time ", "Standard Setup Time",
];
const row = (sku: string, machine: string, cycle: unknown, cavities: unknown = "") =>
  ["", sku, `${sku} description`, "", "", machine, cavities, "", cycle, "0.0625"];

describe("parseProductDetails", () => {
  it("finds the columns by name, trailing spaces and case included", () => {
    const out = parseProductDetails([HEADER, row("ABC1", "Filler Line 1", "3.5", "1")], "f.xlsx");
    expect(out.problems).toEqual([]);
    expect(out.records).toEqual([
      { line: "Filler Line 1", sku: "ABC1", cycleSeconds: 3.5, cavities: 1, source: "f.xlsx" },
    ]);
  });

  it("finds a header that is not on the first row", () => {
    const out = parseProductDetails([["Product Details"], [], HEADER, row("A", "Filler Line 2", 4)], "f");
    expect(out.records).toHaveLength(1);
    expect(out.records[0].cycleSeconds).toBe(4);
  });

  it("refuses a sheet without the columns instead of guessing by position", () => {
    const out = parseProductDetails([["SKU", "Description", "TargetPerHour"], ["A", "x", 600]], "sku_products.xlsx");
    expect(out.records).toEqual([]);
    expect(out.problems[0]).toContain('"Machine"');
    expect(out.problems[0]).toContain('"Standard Cycle Time"');
    expect(out.problems[0]).toContain('"Cavities"');
  });

  it("keeps empty cycles, other machines and repeats, so cleanCycles can list them", () => {
    const out = parseProductDetails(
      [
        HEADER,
        row("A", "Filler Line 1", "3.5"),
        row("A", "Filler Line 1", "4"),
        row("B", "Filler Line 1", ""),
        row("C", "Tablet Line", "2"),
        row("D", "Filler Line 4", "0.31"),
      ],
      "f",
    );
    expect(out.records).toHaveLength(5);
    expect(out.perMachine).toEqual([
      { machine: "Filler Line 1", rows: 3, withCycle: 2 },
      { machine: "Tablet Line", rows: 1, withCycle: 1 },
      { machine: "Filler Line 4", rows: 1, withCycle: 1 },
    ]);
    const { cycles, rejected } = cleanCycles(out.records);
    expect(cycles).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      "No standard cycle time in iTouch.",
      expect.stringContaining("below 1.5 s"),
      "iTouch holds 2 different cycle times for this product on this line.",
    ]);
  });

  it("skips rows with no machine or no part code, and counts the ones that had something", () => {
    const out = parseProductDetails(
      [HEADER, row("", "Filler Line 1", "3"), row("A", "", "3"), ["", "", "", "", "", "", "", "", "", ""], row("B", "Filler Line 3", "3")],
      "f",
    );
    expect(out.records.map((r) => r.sku)).toEqual(["B"]);
    expect(out.skippedRows).toBe(2);
  });

  it("lists cells that are not numbers instead of storing them silently as missing", () => {
    const out = parseProductDetails([HEADER, row("A", "Filler Line 1", "n/a", "two")], "f");
    expect(out.unreadable).toEqual([
      { machine: "Filler Line 1", sku: "A", column: "Standard Cycle Time", value: "n/a" },
      { machine: "Filler Line 1", sku: "A", column: "Cavities", value: "two" },
    ]);
    expect(out.perMachine[0].withCycle).toBe(0);
    expect(toImportRows(out.records)).toEqual([
      { machine: "Filler Line 1", sku: "A", cycle_seconds: null, cavities: null },
    ]);
  });

  it("says so when the columns are there but no row is", () => {
    const out = parseProductDetails([HEADER], "f");
    expect(out.records).toEqual([]);
    expect(out.problems).toHaveLength(1);
  });
});

describe("parseItouchNumber", () => {
  it("reads numbers, numeric text and a decimal comma; empty is null", () => {
    expect(parseItouchNumber(3.5)).toBe(3.5);
    expect(parseItouchNumber(" 5.375 ")).toBe(5.375);
    expect(parseItouchNumber("3,5")).toBe(3.5);
    expect(parseItouchNumber("")).toBeNull();
    expect(parseItouchNumber(null)).toBeNull();
    expect(parseItouchNumber("1,234.5")).toBeNaN();
    expect(parseItouchNumber("abc")).toBeNaN();
  });
});

describe("summariseCycles and the CSV for Production", () => {
  it("counts usable and rejected cycles per Filler Line, conflicts included", () => {
    const { records } = parseProductDetails(
      [
        HEADER,
        row("A", "Filler Line 1", "3.5"),
        row("B", "Filler Line 1", ""),
        row("C", "Filler Line 2", "4"),
        row("C", "Filler Line 2", "5"),
        row("D", "Tablet Line", "2"),
      ],
      "f",
    );
    const { cycles, rejected } = cleanCycles(records);
    expect(summariseCycles(cycles, rejected)).toEqual([
      { line: 1, usable: 1, forProduction: 1 },
      { line: 2, usable: 0, forProduction: 1 },
      { line: 3, usable: 0, forProduction: 0 },
      { line: 4, usable: 0, forProduction: 0 },
      { line: 5, usable: 0, forProduction: 0 },
      { line: 6, usable: 0, forProduction: 0 },
    ]);
  });

  it("quotes a reason that holds a comma", () => {
    const csv = rejectedCyclesCsv([{ line: "Filler Line 4", sku: "X", cycleSeconds: 0.31, reason: "Below 1.5 s, not plausible." }]);
    expect(csv).toBe('Line,SKU,Standard cycle (s),Why it is not used\r\nFiller Line 4,X,0.31,"Below 1.5 s, not plausible."\r\n');
  });
});
