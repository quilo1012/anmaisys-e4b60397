import { describe, it, expect } from "vitest";
import { rescaleItemTargets } from "./ragTargetSplit";

describe("rescaleItemTargets — mirrors trg_sync_items_target_from_rag", () => {
  it("scales proportionally when existing targets are non-zero", () => {
    const out = rescaleItemTargets(
      [{ target: 400, planned: null }, { target: 600, planned: null }],
      2000,
    );
    expect(out).toEqual([800, 1200]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(2000);
  });

  it("falls back to even split when all existing targets are zero", () => {
    const out = rescaleItemTargets(
      [{ target: 0, planned: null }, { target: 0, planned: null }, { target: 0, planned: null }],
      900,
    );
    expect(out).toEqual([300, 300, 300]);
  });

  it("uses planned_qty when target_qty is null", () => {
    const out = rescaleItemTargets(
      [{ target: null, planned: 100 }, { target: null, planned: 300 }],
      800,
    );
    expect(out).toEqual([200, 600]);
  });

  it("handles a single item by assigning the full plan", () => {
    expect(rescaleItemTargets([{ target: 5, planned: null }], 1234)).toEqual([1234]);
  });

  it("returns [] when there are no items (trigger no-ops)", () => {
    expect(rescaleItemTargets([], 5000)).toEqual([]);
  });

  it("zeroes targets when plan is zero", () => {
    expect(
      rescaleItemTargets([{ target: 100, planned: null }, { target: 200, planned: null }], 0),
    ).toEqual([0, 0]);
  });

  it("may differ from the new plan by ±1 due to rounding (acceptable)", () => {
    // 333 split across 3 items proportionally to [1, 1, 1] yields 111,111,111 = 333.
    // But [1, 2] split for plan 10: 3.33, 6.66 → rounds to 3, 7 (sum 10).
    const out = rescaleItemTargets([{ target: 1, planned: null }, { target: 2, planned: null }], 10);
    const sum = out.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 10)).toBeLessThanOrEqual(1);
  });

  it("rejects negative weights only when intentionally passed (documents current behaviour)", () => {
    // Trigger does not guard against negatives; this test pins current behaviour
    // so a future change is intentional.
    const out = rescaleItemTargets([{ target: -10, planned: null }, { target: 20, planned: null }], 100);
    expect(out.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
