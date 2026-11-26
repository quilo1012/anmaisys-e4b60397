import { describe, expect, it } from "vitest";
import { fillSpeedMetrics, parseFillTime, perHourFromSeconds } from "@/lib/fillSpeedMatrixEditor";

describe("editable fill speed matrix", () => {
  it("recalculates 250 g at 2.4 seconds as 1,500 tubs/hour and 25 tubs/minute", () => {
    const metrics = fillSpeedMetrics(2.4, 5.15, 698.7);
    expect(metrics.edited).toBe(true);
    expect(metrics.perHour).toBe(1500);
    expect(metrics.perMinute).toBe(25);
  });

  it("keeps the reviewed sheet figures while the fill time is unchanged", () => {
    const metrics = fillSpeedMetrics(5.15, 5.15, 698.7);
    expect(metrics.edited).toBe(false);
    expect(metrics.perHour).toBe(698.7);
  });

  it("includes the fills per cycle when a capsule machine is corrected", () => {
    expect(perHourFromSeconds(0.5, 5)).toBe(36000);
  });

  it("does not calculate from an empty, zero or negative fill time", () => {
    expect(parseFillTime("")).toBeNull();
    expect(parseFillTime("0")).toBeNull();
    expect(parseFillTime("-2")).toBeNull();
    expect(parseFillTime("2,4")).toBe(2.4);
  });
});
