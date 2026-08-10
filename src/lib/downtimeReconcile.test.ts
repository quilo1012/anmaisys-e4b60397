import { describe, it, expect } from "vitest";
import { unionMinutes, unionMs } from "@/lib/downtimeReconcile";

/**
 * unionMinutes is the Pattern Matrix's cell arithmetic. It used to floor every
 * non-empty interval to one whole minute, which is how a 49-millisecond sliver —
 * WO-809 auto-closed at 06:00:00.049, clipped at the shift boundary — became
 * "0h1m of Line 3 downtime on Thursday" on a day the line never stopped in the
 * day shift. The floor also made the column totals sum to one minute more than
 * the grand total, because the grand total unions the real milliseconds.
 */
describe("unionMinutes", () => {
  it("returns 0 for no intervals", () => {
    expect(unionMinutes([])).toBe(0);
  });

  it("drops a sub-second sliver left by a stop clipped at a shift boundary", () => {
    const boundary = Date.UTC(2026, 7, 6, 5, 0, 0); // 06:00:00.000 London
    expect(unionMinutes([[boundary, boundary + 49]])).toBe(0);
  });

  it("still drops an interval shorter than half a minute", () => {
    const t = Date.UTC(2026, 7, 6, 9, 0, 0);
    expect(unionMinutes([[t, t + 29_000]])).toBe(0);
  });

  it("keeps a stop of half a minute or more as one minute", () => {
    const t = Date.UTC(2026, 7, 6, 9, 0, 0);
    expect(unionMinutes([[t, t + 30_000]])).toBe(1);
  });

  it("counts overlapping stops on different lines once", () => {
    const t = Date.UTC(2026, 7, 3, 10, 0, 0);
    const ivs: [number, number][] = [
      [t, t + 10 * 60_000],
      [t + 2 * 60_000, t + 6 * 60_000],
    ];
    expect(unionMs(ivs)).toBe(10 * 60_000);
    expect(unionMinutes(ivs)).toBe(10);
  });
});
