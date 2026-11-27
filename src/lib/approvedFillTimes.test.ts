import { describe, it, expect } from "vitest";
import { approvedLookup, withApprovedFillTimes, standardSecondsPerUnit } from "./approvedFillTimes";
import { lineShiftPerformance } from "./lineShiftPerformance";

const row = (o: any) => ({ id: "1", machine_name: "Line 4", sku_code: "CRE250", product_description: "", imported_current_seconds: null, suggested_seconds: null, median_seconds: null, sample_shifts: null, approved_seconds: null, time_basis: "per_cycle", units_per_cycle: null, ...o });

describe("approved fill time replaces iTouch", () => {
  it("uses the approved seconds and units per cycle", () => {
    const ap = approvedLookup([row({ approved_seconds: 2.4, units_per_cycle: 2 })]);
    const out = withApprovedFillTimes([{ line: "Line 4", sku: "CRE250", cycleSeconds: 3, cavities: 1, source: "itouch" }], ap);
    expect(out[0]).toMatchObject({ cycleSeconds: 2.4, cavities: 2 });
    expect(standardSecondsPerUnit("Line 4", "CRE250", ap, new Map())?.seconds).toBe(1.2);
  });
  it("keeps iTouch's real seconds when nothing is approved", () => {
    const ap = approvedLookup([row({})]);
    const it = new Map([["line 4|cre250", { line: "Line 4", sku: "CRE250", cycleSeconds: 3, cavities: 1, source: "itouch" }]]);
    expect(standardSecondsPerUnit("Line 4", "CRE250", ap, it)).toEqual({ seconds: 3, from: "itouch" });
  });
  it("performance is standard ÷ real and is not capped at 100", () => {
    const ap = approvedLookup([row({ approved_seconds: 2.4, units_per_cycle: 2 })]);
    // 3000 units in 50 min = 1.0 s/unit vs 1.2 s standard -> 120%
    const [l] = lineShiftPerformance([{ date: "2026-11-26", shift: "DAY", line: "Line 4", sku: "CRE250", name: null, quantity: 3000, runMinutes: 50 }], [], ap);
    expect(l.shifts[0].performance).toBe(120);
  });
});

import { fillKey as fk } from "@/lib/approvedFillTimes";
describe("iTouch and register machine names", () => {
  it("match across naming", () => {
    expect(fk("Filler Line 2", "ABC")).toBe(fk("Line 2", "abc"));
    expect(fk("Capsules MC 1", "X")).toBe(fk("Capsules Machine 1", "X"));
    expect(fk("GEL Machine", "X")).toBe(fk("Gel Machine", "X"));
  });
});
