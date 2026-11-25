import { describe, it, expect } from "vitest";
import { packSizeKg, timeMotionFor } from "@/lib/packSize";

describe("pack size and Time & Motion", () => {
  it("reads grams and kilos from the product name", () => {
    expect(packSizeKg("A.B.E 375G BUBBLEGUM CRUSH")).toBe(0.375);
    expect(packSizeKg("WHEY 2.4KG CHOC")).toBe(2.4);
    expect(packSizeKg("NO SIZE")).toBeNull();
  });
  it("Line 1 0.375 kg is 4.89 s per unit in the sheet", () => {
    expect(timeMotionFor(1, 0.375)?.[2]).toBe(4.89);
  });
  it("a size not on the sheet for that line has no value", () => {
    expect(timeMotionFor(5, 0.375)).toBeNull();
  });
});
