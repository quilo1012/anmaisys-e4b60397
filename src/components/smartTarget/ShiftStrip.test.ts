import { describe, it, expect } from "vitest";
import { stripHours, stripSegments } from "./ShiftStrip";
import { forecastShift, type ShiftForecast } from "@/lib/smartTargetEngine";
import { LINE_RATES_CONFIG } from "@/lib/smartTargetRates";

const rate = (sku: string, source = "Recent shifts of this product: x") => ({ line: 2, sku, value: 600, unit: "containers/hour", status: "provisional" as const, sampleShifts: 5, source });

describe("the shift strip", () => {
  const result = forecastShift({
    date: "2026-11-03", shift: "DAY", line: 2,
    jobs: [
      { jobId: "a", sku: "A", sequence: 1, orderQty: 1200 },
      { jobId: "b", sku: "B", sequence: 2, orderQty: 1200 },
      { jobId: "c", sku: "C", sequence: 3, orderQty: 100000 },
      { jobId: "d", sku: "D", sequence: 4, orderQty: 100 },
    ],
    previousSku: "A",
    rates: [rate("A"), rate("B", "No history: iTouch"), rate("C"), rate("D")],
  }, LINE_RATES_CONFIG);

  it("makes each block as wide as its time, in order, with nothing past the end of the shift", () => {
    const { segments } = stripSegments(result);
    const runs = segments.filter((s) => s.kind === "run");
    expect(runs.map((s) => s.sku)).toEqual(["A", "B", "C"]);
    for (let i = 1; i < segments.length; i++) expect(segments[i].left).toBeGreaterThanOrEqual(segments[i - 1].left);
    const last = segments[segments.length - 1];
    expect(last.left + last.width).toBeLessThanOrEqual(100);
  });

  it("draws changeover and mixing apart, and marks an estimate", () => {
    const { segments } = stripSegments(result);
    expect(segments.find((s) => s.kind === "setup" && s.sku === "B")?.minutes).toBe(55);
    expect(segments.find((s) => s.kind === "run" && s.sku === "B")?.estimated).toBe(true);
    expect(segments.find((s) => s.kind === "run" && s.sku === "A")?.estimated).toBe(false);
  });

  it("lists jobs the shift does not reach instead of drawing them", () => {
    expect(stripSegments(result).notReached).toEqual(["D"]);
  });

  it("draws nothing for a job with no time", () => {
    const blank = { ...result, jobs: [{ ...result.jobs[0], allocation: null }] } as ShiftForecast;
    expect(stripSegments(blank)).toEqual({ segments: [], notReached: [], noTime: ["A"] });
  });

  it("labels the hours of a day, a night across midnight, and a long clock-change night", () => {
    expect(stripHours(6, 720).map((h) => h.label)).toEqual(["06", "08", "10", "12", "14", "16", "18"]);
    expect(stripHours(18, 720).map((h) => h.label)).toEqual(["18", "20", "22", "00", "02", "04", "06"]);
    expect(stripHours(18, 780)[6].left).toBeCloseTo((720 / 780) * 100);
  });
});
