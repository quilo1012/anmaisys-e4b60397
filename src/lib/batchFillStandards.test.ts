import { describe, it, expect } from "vitest";
import { batchFillStandards, batchRunMinutes } from "./batchFillStandards";

const b = (start: string, end: string, quantity: number, o: any = {}) => ({ line: "Line 2", sku: "CW2CL", name: null, batch: null, date: "2026-11-26", startedAt: `2026-11-26T${start}:00Z`, finishedAt: `2026-11-26T${end}:00Z`, quantity, ...o });

describe("fill standard from production batches", () => {
  it("removes recorded stops inside the batch, counting overlaps once", () => {
    const stops = [{ line: "Filler Line 2", startedAt: "2026-11-26T08:10:00Z", endedAt: "2026-11-26T08:20:00Z" }, { line: "Line 2", startedAt: "2026-11-26T08:15:00Z", endedAt: "2026-11-26T08:30:00Z" }];
    expect(batchRunMinutes(b("08:00", "09:00", 100), stops)).toBe(40);
  });
  it("uses the median seconds per unit and needs three batches", () => {
    const two = batchFillStandards([b("08:00", "09:00", 360), b("10:00", "11:00", 400)], []);
    expect(two[0].ready).toBe(false);
    const [s] = batchFillStandards([b("08:00", "09:00", 360), b("10:00", "11:00", 400), b("12:00", "13:00", 300)], []);
    expect(s.standardSeconds).toBe(10);
    expect(s.ready).toBe(true);
  });
  it("drops an outlier batch and ignores batches without a finish", () => {
    const [s] = batchFillStandards([b("08:00", "09:00", 360), b("09:00", "10:00", 360), b("10:00", "11:00", 400), b("11:00", "12:00", 300), b("12:00", "13:00", 40), b("13:00", "13:00", 100)], []);
    expect(s.samples).toHaveLength(5);
    expect(s.samples.filter((x) => x.outlier)).toHaveLength(1);
    expect(s.standardSeconds).toBe(10);
  });
  it("blocks stops with missing timestamps rather than assuming zero downtime", () => {
    expect(batchFillStandards([b("08:00", "09:00", 360)], [{ line: "Line 2", date: "2026-11-26", startedAt: null, endedAt: null, durationMinutes: 10 }])).toEqual([]);
  });
  it("does not reuse overlapping product windows as individual run time", () => {
    expect(batchFillStandards([b("08:00", "09:00", 360), b("08:30", "09:30", 300, { sku: "OTHER" })], [])).toEqual([]);
  });
  it("keeps capsules seconds per unit below a filler cycle floor", () => {
    expect(batchFillStandards([b("08:00", "09:00", 120000)], [])[0].standardSeconds).toBe(0.03);
  });
});
