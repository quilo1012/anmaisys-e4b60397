import { describe, it, expect } from "vitest";
import {
  isSystemClosed,
  buildPatternInsight,
  isMostlyUnresumed,
  type PatternCell,
} from "@/lib/downtimeAttribution";

/**
 * The week of 03/08/2026 read as 45h49m of downtime, of which 42h03m came from
 * stops nobody ever resumed: the shift-close job stamped an end time at 06:00 or
 * 18:00, or iTouching stopped reporting the fault. Line 4's "8h35m on Wednesday"
 * — the number the Auto Insight used to recommend a PM window — is 09:24:36 to
 * 18:00:00.072, a clock closing an order, not a line restarting.
 */
describe("isSystemClosed", () => {
  it("is false for a stop a person resumed", () => {
    expect(
      isSystemClosed({
        ended_at: "2026-08-05T00:28:16.470Z",
        resumed_by: "3f1c-user",
        resumed_by_name: "Engineer",
        notes: null,
      }),
    ).toBe(false);
  });

  it("is false while the stop is still open", () => {
    expect(isSystemClosed({ ended_at: null, resumed_by: null, resumed_by_name: null, notes: null })).toBe(false);
  });

  it("recognises the shift-close job by its note", () => {
    expect(
      isSystemClosed({
        ended_at: "2026-08-06T05:00:00.049Z",
        resumed_by: null,
        resumed_by_name: null,
        notes: " [auto-closed: end of shift]",
      }),
    ).toBe(true);
  });

  it("recognises the backfill variant of the note", () => {
    expect(
      isSystemClosed({
        ended_at: "2026-08-04T17:00:00.000Z",
        resumed_by: null,
        resumed_by_name: null,
        notes: "Belt replaced [auto-closed: backfilled 04/08/2026]",
      }),
    ).toBe(true);
  });

  it("recognises iTouching, which cannot tell a repair from a break", () => {
    expect(
      isSystemClosed({
        ended_at: "2026-08-03T14:41:01.682Z",
        resumed_by: null,
        resumed_by_name: "iTouching",
        notes: "iTouching stopped reporting a fault on this machine.",
      }),
    ).toBe(true);
  });

  it("recognises an older auto-close that landed on a shift boundary with no note", () => {
    // WO-799: resumed at exactly 06:00:00.000 London, resumed_by null, note null.
    expect(
      isSystemClosed({
        ended_at: "2026-08-04T05:00:00.000Z",
        resumed_by: null,
        resumed_by_name: null,
        notes: null,
      }),
    ).toBe(true);
  });

  it("does not accuse a person who happened to resume at the top of the shift", () => {
    expect(
      isSystemClosed({
        ended_at: "2026-08-04T05:00:00.000Z",
        resumed_by: "3f1c-user",
        resumed_by_name: "Engineer",
        notes: null,
      }),
    ).toBe(false);
  });

  it("does not apply the boundary heuristic to a hand-entered record", () => {
    // The manual `downtime` table has no Resume button — a person types the end
    // time, and 06:00 is exactly the round number they would type.
    expect(
      isSystemClosed({
        source: "manual",
        ended_at: "2026-08-04T05:00:00.000Z",
        resumed_by: null,
        resumed_by_name: null,
        notes: null,
      }),
    ).toBe(false);
  });

  it("does not treat a resume away from a boundary as a system close", () => {
    expect(
      isSystemClosed({
        ended_at: "2026-08-04T12:13:00.000Z",
        resumed_by: null,
        resumed_by_name: null,
        notes: null,
      }),
    ).toBe(false);
  });
});

const cell = (key: string, minutes: number, systemMinutes = 0): PatternCell => ({ key, minutes, systemMinutes });

describe("isMostlyUnresumed", () => {
  it("is false for an empty cell", () => {
    expect(isMostlyUnresumed({ minutes: 0, systemMinutes: 0 })).toBe(false);
    expect(isMostlyUnresumed(undefined)).toBe(false);
  });

  it("is false when a person resumed most of the cell", () => {
    expect(isMostlyUnresumed({ minutes: 515, systemMinutes: 100 })).toBe(false);
  });

  it("is true when most of the cell was auto-closed", () => {
    expect(isMostlyUnresumed({ minutes: 515, systemMinutes: 515 })).toBe(true);
  });

  it("uses the same threshold the insight uses", () => {
    const half = { minutes: 100, systemMinutes: 50 };
    expect(isMostlyUnresumed(half)).toBe(false);
    expect(buildPatternInsight("Line 4", 100, [{ key: "2-Day", ...half }])!.verified).toBe(true);
  });
});

describe("buildPatternInsight", () => {
  it("says nothing about a line with under an hour of downtime", () => {
    expect(buildPatternInsight("Line 2", 11, [cell("0-Day", 11)])).toBeNull();
  });

  it("says nothing when downtime is spread evenly across the week", () => {
    const cells = [cell("0-Day", 60), cell("1-Day", 60), cell("2-Day", 60), cell("3-Day", 60)];
    expect(buildPatternInsight("Line 5", 240, cells)).toBeNull();
  });

  it("recommends a PM window when one measured cell dominates", () => {
    const insight = buildPatternInsight("Line 5", 212, [cell("0-Day", 212)])!;
    expect(insight.verified).toBe(true);
    expect(insight.text).toContain("Monday Day shift concentrates 100% of Line 5's downtime (3h 32m)");
    expect(insight.text).toContain("Consider scheduling PM on Sunday night");
  });

  it("schedules a night shift's PM for the day before", () => {
    const insight = buildPatternInsight("Line 3", 707, [cell("2-Night", 707)])!;
    expect(insight.text).toContain("Consider scheduling PM on Wednesday day");
  });

  it("refuses to recommend PM when the dominant cell was mostly auto-closed", () => {
    // Line 4, Wednesday day shift: 515 minutes, all of it 09:24 → 18:00:00.072.
    const insight = buildPatternInsight("Line 4", 646, [cell("2-Day", 515, 515), cell("0-Day", 59)])!;
    expect(insight.verified).toBe(false);
    expect(insight.text).not.toContain("Consider scheduling PM");
    expect(insight.text).toContain("80%");
    expect(insight.text).toContain("100% of it was auto-closed");
  });

  it("still recommends PM when only a minority of the cell was auto-closed", () => {
    const insight = buildPatternInsight("Line 4", 646, [cell("2-Day", 515, 100)])!;
    expect(insight.verified).toBe(true);
    expect(insight.text).toContain("Consider scheduling PM");
  });
});
