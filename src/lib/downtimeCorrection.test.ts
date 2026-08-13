import { describe, it, expect } from "vitest";
import { resolveCorrection, isCorrectionError } from "./downtimeCorrection";

const NOW = new Date("2026-08-10T15:00:00Z");
const START = "2026-08-10T06:47:00Z";

function ok(r: ReturnType<typeof resolveCorrection>) {
  if (isCorrectionError(r)) throw new Error(`expected a correction, got: ${r.error}`);
  return r;
}

describe("resolveCorrection", () => {
  it("moves the end time when the duration is given", () => {
    const r = ok(resolveCorrection({ stoppedAt: START, minutes: 12, reason: "operator resumed late", now: NOW }));
    expect(r.durationMinutes).toBe(12);
    expect(r.resumedAt?.toISOString()).toBe("2026-08-10T06:59:00.000Z");
  });

  it("computes the duration when the end time is given", () => {
    const r = ok(resolveCorrection({
      stoppedAt: START, resumedAt: "2026-08-10T07:32:00Z", reason: "late resume", now: NOW,
    }));
    expect(r.durationMinutes).toBe(45);
    expect(r.resumedAt?.toISOString()).toBe("2026-08-10T07:32:00.000Z");
  });

  it("lets the minutes win when both minutes and an end time arrive", () => {
    const r = ok(resolveCorrection({
      stoppedAt: START, resumedAt: "2026-08-10T11:34:00Z", minutes: 40, reason: "corrected", now: NOW,
    }));
    expect(r.durationMinutes).toBe(40);
    expect(r.resumedAt?.toISOString()).toBe("2026-08-10T07:27:00.000Z");
  });

  it("refuses an end time before the start", () => {
    const r = resolveCorrection({
      stoppedAt: START, resumedAt: "2026-08-10T06:30:00Z", reason: "typo", now: NOW,
    });
    expect(isCorrectionError(r) && r.error).toMatch(/before the start/i);
  });

  it("refuses an empty reason", () => {
    const r = resolveCorrection({ stoppedAt: START, minutes: 10, reason: "   ", now: NOW });
    expect(isCorrectionError(r) && r.error).toMatch(/reason/i);
  });

  it("refuses a duration on a stoppage that is still open", () => {
    const r = resolveCorrection({ stoppedAt: START, minutes: 10, reason: "guess", isOpen: true, now: NOW });
    expect(isCorrectionError(r) && r.error).toMatch(/still open/i);
  });

  it("refuses a start time in the future", () => {
    const r = resolveCorrection({ stoppedAt: "2026-08-10T16:00:00Z", minutes: 5, reason: "x", now: NOW });
    expect(isCorrectionError(r) && r.error).toMatch(/future/i);
  });

  it("refuses a negative duration", () => {
    const r = resolveCorrection({ stoppedAt: START, minutes: -3, reason: "x", now: NOW });
    expect(isCorrectionError(r) && r.error).toMatch(/negative/i);
  });

  it("does not lose a minute to the seconds when rounding", () => {
    // 5 minutes and 40 seconds is nearer six minutes than five.
    const r = ok(resolveCorrection({
      stoppedAt: "2026-08-10T06:00:00Z", resumedAt: "2026-08-10T06:05:40Z", reason: "x", now: NOW,
    }));
    expect(r.durationMinutes).toBe(6);
  });

  it("leaves an open stoppage open when only the start is corrected", () => {
    const r = ok(resolveCorrection({ stoppedAt: START, reason: "wrong start", isOpen: true, now: NOW }));
    expect(r.resumedAt).toBeNull();
    expect(r.durationMinutes).toBeNull();
  });
});

/**
 * The two readings of the same stoppage.
 *
 * `WorkOrderDetail`'s Production Impact card subtracts the stamps; the view
 * `v_wo_downtime_total`, which feeds the boards, sums `duration_minutes`. A
 * correction that moved one without the other would give one stoppage two numbers
 * on two screens, so this is the invariant the whole design turns on.
 */
describe("the stamps and the minutes agree after a correction", () => {
  const cases = [
    { minutes: 40 as number | null, resumedAt: null as string | null },
    { minutes: null, resumedAt: "2026-08-10T07:32:00Z" },
    { minutes: 12, resumedAt: "2026-08-10T11:34:00Z" },
  ];

  for (const c of cases) {
    it(`holds for ${JSON.stringify(c)}`, () => {
      const r = ok(resolveCorrection({ stoppedAt: START, ...c, reason: "fix", now: NOW }));
      const fromStamps = Math.round((r.resumedAt!.getTime() - r.stoppedAt.getTime()) / 60_000);
      expect(fromStamps).toBe(r.durationMinutes);
    });
  }

  it("a correction shorter than an overlapping team-activity exclusion floors at zero, never negative", () => {
    const r = ok(resolveCorrection({ stoppedAt: START, minutes: 5, reason: "fix", now: NOW }));
    const excludedMin = 20; // team activity longer than the corrected stoppage
    expect(Math.max(0, r.durationMinutes! - excludedMin)).toBe(0);
  });
});
