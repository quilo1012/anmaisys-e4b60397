import { describe, it, expect } from "vitest";
import { deviationPct, reviewBatches, shiftOfStart, shiftStandards } from "./batchReview";

const run = (startedAt: string, finishedAt: string, quantity: number) => ({ line: "Line 6", sku: "CW2C", name: "2KG", batch: null, date: startedAt.slice(0, 10), startedAt, finishedAt, quantity });

describe("batch review", () => {
  it("subtracts stops and gives seconds per unit", () => {
    const [r] = reviewBatches([run("2026-11-02T08:00:00", "2026-11-02T09:00:00", 300)], [{ line: "Line 6", date: "2026-11-02", startedAt: "2026-11-02T08:10:00", endedAt: "2026-11-02T08:20:00", durationMinutes: 10 }]);
    expect(r.stopMinutes).toBe(10); expect(r.secondsPerUnit).toBe(10); expect(r.shift).toBe("Day");
  });
  it("splits standards by shift", () => {
    const rows = reviewBatches([run("2026-11-02T08:00:00", "2026-11-02T09:00:00", 360), run("2026-11-02T20:00:00", "2026-11-02T21:00:00", 300)], []);
    expect(shiftStandards(rows).map((s) => [s.shift, s.medianSeconds])).toEqual([["Day", 10], ["Night", 12]]);
  });
  it("deviation is positive when slower than standard", () => {
    expect(deviationPct(7.8, 9.36)).toBe(20); expect(deviationPct(null, 5)).toBeNull();
  });
  it("uses the configured London shift hours", () => {
    expect(shiftOfStart("2026-11-02T06:30:00Z")).toBe("Day");
    expect(shiftOfStart("2026-11-02T06:30:00Z", { dayStart: 7, dayEnd: 19 })).toBe("Night");
    expect(shiftOfStart("2026-07-02T05:30:00Z", { dayStart: 6, dayEnd: 18 })).toBe("Day");
  });
});
