import { describe, it, expect } from "vitest";
import { skuStandardRate, formatStandardRate } from "./skuStandardRate";

/**
 * `sku_products.target_per_hour` defaults to 0 (migration 20260724160000), and 208
 * active SKUs still carry that default. So by the time a row reaches a screen, "we
 * never recorded a rate for this product" and "this product runs at zero an hour"
 * are the same number.
 *
 * `?? 0` cannot separate them — the value is already 0, not null — and the SKU
 * Efficiency table printed it raw, on screen and into the exported workbook. A zero
 * in a spreadsheet that gets forwarded reads as a measurement.
 *
 * Zero is not a rate any active product could have; a product that makes nothing an
 * hour is not a product. So zero is read here as the absence it is.
 */
describe("skuStandardRate", () => {
  it("reads the database default as no rate recorded", () => {
    expect(skuStandardRate(0)).toBeNull();
  });

  it("reads a missing value as no rate recorded", () => {
    expect(skuStandardRate(null)).toBeNull();
    expect(skuStandardRate(undefined)).toBeNull();
  });

  it("keeps a rate that was actually recorded", () => {
    expect(skuStandardRate(120)).toBe(120);
    expect(skuStandardRate(37.5)).toBe(37.5);
  });

  it("accepts the string a numeric column arrives as", () => {
    expect(skuStandardRate("150")).toBe(150);
  });

  it("treats a negative or unreadable rate as absent rather than as data", () => {
    expect(skuStandardRate(-5)).toBeNull();
    expect(skuStandardRate("not a number")).toBeNull();
  });
});

describe("formatStandardRate", () => {
  it("shows an em dash where there is no rate, never a zero", () => {
    expect(formatStandardRate(null)).toBe("—");
    expect(formatStandardRate(skuStandardRate(0))).toBe("—");
  });

  it("shows the rate when there is one", () => {
    expect(formatStandardRate(1200)).toBe("1,200");
  });
});
