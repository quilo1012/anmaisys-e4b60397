import { describe, expect, it } from "vitest";
import { rowMatchesShift } from "@/lib/shifts";

/**
 * The regression this exists for.
 *
 * Analytics answered "which shift is this action" three different ways on one screen.
 * The leader table did not ask at all — its `analytics-leader-period-actions` query
 * carried no shift, while `analytics-leader-perf` beside it did — so switching to
 * NIGHT gave a leader night production and their whole month's quality points. The
 * Quality block guessed the shift from the hour on `recorded_at`, so a night action
 * written up at 07:00 counted as DAY there and as NIGHT on the scorecard.
 *
 * A quality action carries its own shift. This is the one question, asked once, and
 * it matches `actionsInPeriod`, which is what the leader scorecard has always used.
 */

describe("rowMatchesShift", () => {
  it("keeps everything when no shift is selected", () => {
    expect(rowMatchesShift("DAY", "ALL")).toBe(true);
    expect(rowMatchesShift("NIGHT", "ALL")).toBe(true);
    expect(rowMatchesShift(null, "ALL")).toBe(true);
  });

  it("matches the row's own column, not the hour it was written at", () => {
    expect(rowMatchesShift("NIGHT", "NIGHT")).toBe(true);
    expect(rowMatchesShift("DAY", "NIGHT")).toBe(false);
    expect(rowMatchesShift("DAY", "DAY")).toBe(true);
  });

  it("reads a sloppily stored value the same way the scorecard does", () => {
    expect(rowMatchesShift("night", "NIGHT")).toBe(true);
    expect(rowMatchesShift("  Day  ", "DAY")).toBe(true);
  });

  it("drops a row with no shift from a shift-filtered view", () => {
    // The scorecard's rule: blank is not DAY and not NIGHT. Counting it in both would
    // make the two shifts add up to more than the total.
    expect(rowMatchesShift(null, "DAY")).toBe(false);
    expect(rowMatchesShift("", "NIGHT")).toBe(false);
    expect(rowMatchesShift("   ", "DAY")).toBe(false);
    expect(rowMatchesShift(undefined, "NIGHT")).toBe(false);
  });
});
