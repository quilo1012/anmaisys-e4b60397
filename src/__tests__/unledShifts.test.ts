/**
 * The shifts the board cannot show.
 *
 * `scorecard_week_board` is built from `production_sessions` and keeps only the rows
 * whose leader resolves. A session with no leader at all is therefore not a row with a
 * blank name — it is absent, and nothing on the screen said so. Measured on 16/09/2026:
 * 183 of 780 sessions, 10% to 24% of every week, still happening today.
 *
 * These sessions cannot be repaired after the fact — of the 183, exactly 5 could be
 * traced to a leader through `daily_allocations`. So the only honest thing the screen
 * can do is say how much of the week it is not showing.
 */
import { describe, it, expect } from "vitest";
import { summariseUnledShifts } from "@/lib/scorecardWeek";

describe("summariseUnledShifts", () => {
  it("is empty for a week where every shift had a leader", () => {
    expect(summariseUnledShifts([])).toEqual({ total: 0, lines: [] });
  });

  it("counts the shifts and names the lines they happened on", () => {
    const got = summariseUnledShifts([
      { line: "Line 4" },
      { line: "Line 1" },
      { line: "Line 4" },
      { line: "Tablet Line" },
    ]);
    expect(got.total).toBe(4);
    // Each line once, in a stable order — the sentence must not reshuffle itself
    // between renders of the same week.
    expect(got.lines).toEqual(["Line 1", "Line 4", "Tablet Line"]);
  });

  it("still counts a shift whose line is missing, rather than dropping it", () => {
    // A session with no line is worse than one with no leader, not better. Counting it
    // and leaving it out of the list keeps the total honest — the alternative silently
    // shrinks the very number this exists to surface.
    const got = summariseUnledShifts([{ line: "Line 2" }, { line: null }]);
    expect(got.total).toBe(2);
    expect(got.lines).toEqual(["Line 2"]);
  });

  it("treats a blank line name as missing rather than as a line called nothing", () => {
    const got = summariseUnledShifts([{ line: "   " }, { line: "Line 6" }]);
    expect(got.total).toBe(2);
    expect(got.lines).toEqual(["Line 6"]);
  });
});
