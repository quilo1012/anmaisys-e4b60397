import { describe, it, expect } from "vitest";
import { fillFromQueue, isCurrentShift, queueRowsFromSections, type QueueRow } from "./smartTargetQueue";
import type { PlannedJob } from "./smartTargetEngine";

const q = (line: string, seq: number, sku: string, order_qty: number | null, done_qty: number | null = 0): QueueRow => ({
  line, seq, sku, order_qty, done_qty, status: null,
});
const job = (jobId: string, sku: string | null, orderQty: number | null = null): PlannedJob => ({ jobId, sku, sequence: 1, orderQty });

describe("queueRowsFromSections", () => {
  it("keeps line, position, part code, order and made, and drops rows without a part code", () => {
    expect(queueRowsFromSections([
      { line: "Line 2", items: [
        { sku_code: "AFCIB-B2", qty: 6607, actual: 1200, status: "Running", seq: 1 },
        { sku_code: "", qty: 5 },
        { sku_code: "ABEENG", qty: 900, seq: null },
      ] },
    ])).toEqual([
      { line: "Line 2", seq: 1, sku: "AFCIB-B2", order_qty: 6607, done_qty: 1200, status: "Running" },
      { line: "Line 2", seq: 3, sku: "ABEENG", order_qty: 900, done_qty: null, status: null },
    ]);
  });
});

describe("fillFromQueue", () => {
  it("fills a job with what is left of the same SKU's order, batch suffix ignored", () => {
    const r = fillFromQueue(2, [job("j1", "AFCIB")], [q("Line 2", 1, "AFCIB-B2", 6607, 1200)]);
    expect(r.jobs[0].orderQty).toBe(5407);
    expect(r.filled).toBe(1);
  });

  it("never takes a quantity from another product or another line", () => {
    const r = fillFromQueue(2, [job("j1", "AFCIB")], [q("Line 2", 1, "ABEENG", 900), q("Line 3", 1, "AFCIB", 500)]);
    expect(r.jobs[0].orderQty).toBeNull();
    expect(r.filled).toBe(0);
  });

  it("uses each queued order once, in queue order", () => {
    const r = fillFromQueue(5, [job("a", "MMMG2V"), job("b", "MMMG2V")], [q("Line 5", 2, "MMMG2V", 300), q("Line 5", 1, "MMMG2V", 1000)]);
    expect(r.jobs.map((j) => j.orderQty)).toEqual([1000, 300]);
  });

  it("keeps a quantity the plan already has, and leaves an order iTouch counts as made unquantified", () => {
    const r = fillFromQueue(1, [job("a", "ABEENG", 400), job("b", "COL")], [q("Line 1", 1, "ABEENG", 9999), q("Line 1", 2, "COL", 500, 500)]);
    expect(r.jobs.map((j) => j.orderQty)).toEqual([400, null]);
    expect(r.filled).toBe(0);
  });
});

describe("isCurrentShift", () => {
  it("is true only for the shift running now, night included", () => {
    const night = new Date("2026-11-06T02:00:00Z"); // 02:00 London belongs to the 5th's night
    expect(isCurrentShift("2026-11-05", "NIGHT", night)).toBe(true);
    expect(isCurrentShift("2026-11-06", "DAY", night)).toBe(false);
    expect(isCurrentShift("2026-11-05", "DAY", new Date("2026-11-05T10:00:00Z"))).toBe(true);
  });
});
