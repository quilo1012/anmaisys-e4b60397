import { describe, it, expect } from "vitest";
import {
  aheadShift,
  forecastAhead,
  planFromQueue,
  NO_ITOUCH_JOBS,
  productsOffPlan,
} from "./smartTargetAhead";
import { fillFromQueue, queuedProduct, type QueueRow } from "./smartTargetQueue";
import type { CleanCycle, LineFactor } from "./smartTargetRates";
import type { RateRecord } from "./smartTargetEngine";

/** 5 November 2026 is GMT: London wall time equals UTC. */
const q = (line: string, seq: number, sku: string, order: number | null, done: number | null, status: string | null = null): QueueRow => ({
  line, seq, sku, order_qty: order, done_qty: done, status,
});
const rate = (sku: string, perHour: number): RateRecord => ({
  line: 2, sku, value: perHour, unit: "containers/hour", status: "provisional", sampleShifts: 20, source: "fixture",
});

describe("aheadShift", () => {
  it("picks the shift starting within 40 minutes, and says when it is the last run", () => {
    expect(aheadShift(new Date("2026-11-05T05:30:00Z"))).toEqual({ date: "2026-11-05", shift: "DAY", minutesToStart: 30, final: false });
    expect(aheadShift(new Date("2026-11-05T05:50:00Z"))).toEqual({ date: "2026-11-05", shift: "DAY", minutesToStart: 10, final: true });
    expect(aheadShift(new Date("2026-11-05T17:30:00Z"))).toMatchObject({ date: "2026-11-05", shift: "NIGHT", final: false });
  });

  it("does nothing at any other time, so the cron can run on both UTC offsets", () => {
    // 04:30 UTC in GMT is 04:30 in London: 90 minutes early.
    expect(aheadShift(new Date("2026-11-05T04:30:00Z"))).toBeNull();
    expect(aheadShift(new Date("2026-11-05T06:10:00Z"))).toBeNull();
    // In BST the day shift starts at 05:00 UTC, so the 04:30 UTC run is the one that counts.
    expect(aheadShift(new Date("2026-07-01T04:30:00Z"))).toMatchObject({ date: "2026-07-01", shift: "DAY", minutesToStart: 30 });
    expect(aheadShift(new Date("2026-07-01T05:30:00Z"))).toBeNull();
  });
});

describe("planFromQueue", () => {
  it("puts the running job first and takes off what it fills before the shift starts (Q38)", () => {
    const plan = planFromQueue(2, [
      q("Line 2", 1, "next", 3000, 0),
      q("Line 2", 4, "run", 5000, 3000, "Running"),
      q("Line 4", 1, "other", 900, 0),
    ], 30, [rate("RUN", 600)]);
    // 2000 left, minus 30 min at 600/h = 300.
    expect(plan.jobs.map((j) => [j.sku, j.orderQty])).toEqual([["RUN", 1700], ["NEXT", 3000]]);
    expect(plan.previousSku).toBe("RUN");
    expect(plan.notes[0]).toMatch(/estimated left at the start/);
  });

  it("drops a running job that finishes before the shift, but the line was still last filling it", () => {
    const plan = planFromQueue(2, [q("Line 2", 1, "run", 1000, 900, "Running"), q("Line 2", 2, "next", 500, 0)], 30, [rate("RUN", 600)]);
    expect(plan.jobs.map((j) => j.sku)).toEqual(["NEXT"]);
    expect(plan.previousSku).toBe("RUN");
  });

  it("takes nothing off without a rate, and says so", () => {
    const plan = planFromQueue(2, [q("Line 2", 1, "run", 1000, 200, "Running")], 30, []);
    expect(plan.jobs[0].orderQty).toBe(800);
    expect(plan.notes[0]).toMatch(/not taken off/);
  });

  it("leaves the starting SKU unknown when nothing is running, and skips orders already made", () => {
    const plan = planFromQueue(2, [q("Line 2", 1, "a", 1000, 1000), q("Line 2", 2, "b", null, null)], 30, []);
    expect(plan.previousSku).toBeUndefined();
    expect(plan.jobs.map((j) => [j.sku, j.orderQty])).toEqual([["B", null]]);
  });
});

describe("batches in iTouch's queue", () => {
  it("are one job of one product, as on 06/11: CRE500 - B15 to B20 on Line 4", () => {
    const plan = planFromQueue(4, [
      q("Line 4", 15, "CRE500 - B15", 2500, 0, "Scheduled"),
      q("Line 4", 16, "CRE500 - B16", 2500, 0, "Scheduled"),
      q("Line 5", 1, "BEEFXPCA -B1", 1777, 0, "Scheduled"),
    ], 0, []);
    expect(plan.jobs.map((j) => [j.sku, j.orderQty])).toEqual([["CRE500", 5000]]);
    expect(planFromQueue(5, [q("Line 5", 1, "BEEFXPCA -B1", 1777, 0)], 0, []).jobs[0].sku).toBe("BEEFXPCA");
  });

  it("fill a plan row with the whole run, not its first batch", () => {
    const { jobs, filled } = fillFromQueue(4, [{ jobId: "a", sku: "CRE500", sequence: 1, orderQty: null }], [
      q("Line 4", 15, "CRE500 - B15", 2500, 500),
      q("Line 4", 16, "CRE500 - B16", 2500, 0),
    ]);
    expect(filled).toBe(1);
    expect(jobs[0].orderQty).toBe(4500);
  });

  it("leave a part code that only looks like a batch alone", () => {
    expect(queuedProduct("PERUCRE1KG - 26")).toBe("PERUCRE1KG - 26");
    expect(queuedProduct("BCAA")).toBe("BCAA");
  });
});

describe("forecastAhead", () => {
  const cycles: CleanCycle[] = [{ line: 2, sku: "A", idealPerHour: 1200, cycleSeconds: 3, source: "iTouch" }];
  const factors: LineFactor[] = [{ line: 2, factor: 0.5, shiftsUsed: 30, excluded: [] }];
  const base = { date: "2026-11-05", shift: "DAY" as const, minutesToStart: 30, cycles, factors, history: [], shownLines: [2, 4, 5] as const };

  it("forecasts the lines with jobs and leaves out empty ones before the last run", () => {
    const { rows } = forecastAhead({ ...base, final: false, queue: [q("Line 2", 1, "A", 100000, 0)] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ line: 2, shown: true, status: expect.not.stringMatching(NO_ITOUCH_JOBS), factor: 0.5, factor_shifts: 30 });
    // 600/h for the rest of the shift: the order is bigger than the shift.
    expect(rows[0].expected_total).toBeGreaterThan(5000);
    expect(rows[0].expected_per_hour).toBeGreaterThan(0);
    expect(rows[0].jobs[0]).toMatchObject({ sku: "A", order: 100000, basis: "order_qty_at_rate" });
  });

  it("on the last run, saves every line without jobs as such, never with a number (Q36)", () => {
    const { rows } = forecastAhead({ ...base, final: true, minutesToStart: 10, queue: [q("Line 2", 1, "A", 1000, 0)] });
    const empty = rows.filter((r) => r.status === NO_ITOUCH_JOBS);
    expect(empty.map((r) => r.line)).toEqual([1, 3, 4, 5, 6]);
    expect(empty.every((r) => r.expected_total === null && r.jobs.length === 0)).toBe(true);
    expect(empty.find((r) => r.line === 1)?.shown).toBe(false);
  });

  it("shows the lines the visibility rule says, and forecasts the rest in shadow (Q45a)", () => {
    const { rows } = forecastAhead({ ...base, shownLines: [1], final: false, queue: [q("Line 1", 1, "A", 1000, 0), q("Line 2", 1, "A", 1000, 0)] });
    expect(rows.map((r) => [r.line, r.shown])).toEqual([[1, true], [2, false]]);
  });

  it("gives a number for a product whose base row rests on few shifts, as on 06/11 (Line 6)", () => {
    const { rows } = forecastAhead({ ...base, cycles: [], factors: [], shownLines: [6], final: false, queue: [
      q("Line 6", 1, "CWBAG450V - B2", 3333, 0, "Scheduled"),
      q("Line 6", 2, "CW825V - B3", 1818, 0, "Scheduled"),
    ] });
    expect(rows[0]).toMatchObject({ line: 6, status: "ok" });
    expect(rows[0].expected_total).toBeGreaterThan(0);
    expect(rows[0].jobs.every((j) => j.expected !== null)).toBe(true);
  });

  it("a tiny product with no rate no longer blanks the line, as on Line 2 on 06/11 (Q56a)", () => {
    const { rows } = forecastAhead({ ...base, cycles: [], factors: [], shownLines: [2], final: false, queue: [
      q("Line 2", 1, "BLENDEDCOLDEBLOATLGT - B2", 80, 0, "Scheduled"),
      q("Line 2", 2, "COL165SR", 1000, 0, "Scheduled"),
    ] });
    expect(rows[0].expected_total).toBeGreaterThan(0);
    expect(rows[0].jobs.every((j) => j.expected !== null)).toBe(true);
  });

  it("forecasts held-back lines in shadow", () => {
    const { rows } = forecastAhead({ ...base, final: false, queue: [q("Line 1", 1, "A", 1000, 0)] });
    expect(rows).toEqual([expect.objectContaining({ line: 1, shown: false })]);
  });
});

describe("productsOffPlan", () => {
  it("lists logged products the frozen plan did not have, once each, whatever their spelling", () => {
    const target = { jobs: [{ sku: "AFCIB" }, { sku: "ISO850" }] };
    expect(productsOffPlan(target, ["afcib ", "CARBBM", "ISO850", "CARBBM"])).toEqual(["CARBBM"]);
    expect(productsOffPlan(target, ["AFCIB"])).toEqual([]);
  });
});
