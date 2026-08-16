import { describe, it, expect } from "vitest";
import { machineReliability } from "./machineReliability";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-08-16T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * HOUR).toISOString();

/**
 * A force-closed order is an order that ended. `force_close_work_order` exists for
 * the ones nobody will sign off, and the line was stopped for just as long either way.
 *
 * This page counted "done" against its own list of three statuses, leaving
 * force_closed out. Its downtime went uncounted, so the reliability figure — which is
 * 100 minus downtime over the period — came out HIGHER. The machine whose orders keep
 * having to be forced closed read as the most reliable one in the factory.
 */
describe("machineReliability", () => {
  it("counts a force-closed order's downtime like any other", () => {
    const wos = [
      { status: "force_closed", created_at: ago(10), started_at: ago(9), finished_at: ago(7), completed_at: null },
    ];
    const s = machineReliability(wos, now);
    expect(s.totalDowntime).toBe(120);
    expect(s.completed).toBe(1);
  });

  it("gives the same answer whether the order was signed off or forced", () => {
    const forced = [{ status: "force_closed", created_at: ago(10), started_at: ago(9), finished_at: ago(7), completed_at: null }];
    const signed = [{ status: "closed", created_at: ago(10), started_at: ago(9), finished_at: ago(7), completed_at: null }];
    expect(machineReliability(forced, now)).toEqual(machineReliability(signed, now));
  });

  it("does not let a forced order flatter the reliability figure", () => {
    const wos = [
      { status: "force_closed", created_at: ago(10), started_at: ago(9), finished_at: ago(4), completed_at: null },
    ];
    // Five hours down in a ten-hour period. Reading it as 100% would be the bug.
    expect(machineReliability(wos, now).reliability).toBe(50);
  });

  it("ignores orders that have not ended", () => {
    const wos = [
      { status: "in_progress", created_at: ago(10), started_at: ago(9), finished_at: null, completed_at: null },
    ];
    const s = machineReliability(wos, now);
    expect(s.completed).toBe(0);
    expect(s.totalDowntime).toBe(0);
    expect(s.total).toBe(1);
  });

  it("falls back to completed_at when finished_at is absent", () => {
    const wos = [
      { status: "completed", created_at: ago(10), started_at: ago(9), finished_at: null, completed_at: ago(8) },
    ];
    expect(machineReliability(wos, now).totalDowntime).toBe(60);
  });

  it("never reports a negative reliability", () => {
    const wos = [
      { status: "closed", created_at: ago(2), started_at: ago(50), finished_at: ago(1), completed_at: null },
    ];
    expect(machineReliability(wos, now).reliability).toBeGreaterThanOrEqual(0);
  });

  it("answers for a machine with no orders at all", () => {
    const s = machineReliability([], now);
    expect(s).toEqual({ total: 0, completed: 0, totalDowntime: 0, reliability: 100 });
  });
});
