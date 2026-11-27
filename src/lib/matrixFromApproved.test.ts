import { describe, it, expect } from "vitest";
import { packStandardsFromApproved } from "./matrixFromApproved";
import { lineFillTimeKey } from "./fillSpeedMatrixEditor";

const row = (o: any) => ({ id: o.sku, machine_name: o.line, sku_code: o.sku, product_description: o.desc, imported_current_seconds: null, suggested_seconds: null, median_seconds: null, sample_shifts: null, approved_seconds: o.s, time_basis: o.basis ?? "per_unit", units_per_cycle: o.units ?? 1 });

describe("packStandardsFromApproved", () => {
  it("takes the median approved seconds per tub for each line and pack size", () => {
    const m = packStandardsFromApproved([
      row({ line: "Line 6", sku: "A", desc: "WHEY 2KG CHOC", s: 7 }),
      row({ line: "Filler Line 6", sku: "B", desc: "WHEY 2KG VAN", s: 8 }),
      row({ line: "Line 6", sku: "C", desc: "WHEY 2KG STR", s: 12 }),
      row({ line: "Line 6", sku: "D", desc: "WHEY 2KG X", s: null }),
    ]);
    expect(m.get(lineFillTimeKey(6, 2))).toEqual({ seconds: 8, skus: 3 });
  });
  it("divides per-cycle approvals by units per cycle", () => {
    const m = packStandardsFromApproved([row({ line: "Line 4", sku: "E", desc: "AMINO 390G", s: 6, basis: "per_cycle", units: 2 })]);
    expect(m.get(lineFillTimeKey(4, 0.39))?.seconds).toBe(3);
  });
});

import { packStandardsFromBatches } from "./matrixFromApproved";
describe("packStandardsFromBatches", () => {
  it("uses only ready standards, median per line and size", () => {
    const m = packStandardsFromBatches([
      { line: "Filler Line 6", sku: "A", name: "WHEY 2KG", standardSeconds: 10, ready: true },
      { line: "Line 6", sku: "B", name: "WHEY 2KG", standardSeconds: 12, ready: true },
      { line: "Line 6", sku: "C", name: "WHEY 2KG", standardSeconds: 99, ready: false },
    ]);
    expect([...m.values()]).toEqual([{ seconds: 11, skus: 2 }]);
  });
});
