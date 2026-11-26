import { describe, it, expect } from "vitest";
import { checkItouchFillTimes } from "@/lib/itouchFillTimeCheck";

const names: Record<string, string> = { A: "Whey 375G", B: "Whey 375G", C: "Whey 375G" };
const rec = (sku: string, s: number | null) => ({ line: "Line 1", sku, cycleSeconds: s, cavities: 1, source: "x" });

describe("checkItouchFillTimes", () => {
  it("flags a missing fill time", () => {
    const r = checkItouchFillTimes([rec("A", null)], (s) => names[s]);
    expect(r).toHaveLength(1);
  });
  it("flags iTouch 3.5 s against matrix 4.89 s on Line 1 375 g", () => {
    const r = checkItouchFillTimes([rec("B", 3.0)], (s) => names[s]);
    expect(r[0].matrixSeconds).toBe(4.89);
  });
  it("accepts a fill time close to the matrix", () => {
    expect(checkItouchFillTimes([rec("C", 5.0)], (s) => names[s])).toHaveLength(0);
  });
});
