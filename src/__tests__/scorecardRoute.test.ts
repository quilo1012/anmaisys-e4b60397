import { describe, expect, it } from "vitest";
import { parseScorecardParams, scorecardPath } from "@/lib/scorecardRoute";

/**
 * The scorecard has an address now, so the address has to be read defensively.
 *
 * A link that carries a leader and a period can be pasted, bookmarked and mailed
 * around, which means it will eventually arrive truncated, hand-edited, or a month
 * out of date. None of that may render a scorecard about the wrong person or over a
 * period nobody asked for — the one screen where being wrong about somebody costs
 * the most.
 */

const TODAY = "2026-08-17";

describe("scorecardPath", () => {
  it("carries the leader and the period the screen was showing", () => {
    expect(scorecardPath("Ailton", { from: "2026-08-01", to: "2026-08-17", shift: "DAY" }))
      .toBe("/dashboard/leader-scorecard/Ailton?from=2026-08-01&to=2026-08-17&shift=DAY");
  });

  it("escapes a name with a space, so the link survives being pasted", () => {
    expect(scorecardPath("Rafael Tosta", { from: "2026-08-01", to: "2026-08-01", shift: "all" }))
      .toBe("/dashboard/leader-scorecard/Rafael%20Tosta?from=2026-08-01&to=2026-08-01");
  });

  it("leaves shift out of the address when no shift is selected", () => {
    expect(scorecardPath("Ailton", { from: "2026-08-01", to: "2026-08-01", shift: "all" }))
      .not.toContain("shift");
  });
});

describe("parseScorecardParams", () => {
  it("reads a well-formed address", () => {
    const r = parseScorecardParams("Ailton", new URLSearchParams("from=2026-08-01&to=2026-08-17&shift=NIGHT"), TODAY);
    expect(r).toEqual({ leader: "Ailton", from: "2026-08-01", to: "2026-08-17", shift: "NIGHT" });
  });

  it("falls back to today when the period is missing, rather than to all of history", () => {
    // A truncated link must not quietly widen the period. Today is the smallest
    // honest answer, and the card prints the dates it used.
    const r = parseScorecardParams("Ailton", new URLSearchParams(""), TODAY);
    expect(r.from).toBe(TODAY);
    expect(r.to).toBe(TODAY);
  });

  it("refuses a date that is not a date", () => {
    const r = parseScorecardParams("Ailton", new URLSearchParams("from=last-tuesday&to=2026-08-17"), TODAY);
    expect(r.from).toBe(TODAY);
    expect(r.to).toBe("2026-08-17");
  });

  it("puts a reversed period back in order instead of rendering nothing", () => {
    const r = parseScorecardParams("Ailton", new URLSearchParams("from=2026-08-17&to=2026-08-01"), TODAY);
    expect(r.from).toBe("2026-08-01");
    expect(r.to).toBe("2026-08-17");
  });

  it("treats any shift it does not recognise as no shift filter", () => {
    expect(parseScorecardParams("A", new URLSearchParams("shift=AFTERNOON"), TODAY).shift).toBe("all");
    expect(parseScorecardParams("A", new URLSearchParams("shift=day"), TODAY).shift).toBe("DAY");
  });

  it("reports a missing leader as null rather than an empty scorecard", () => {
    expect(parseScorecardParams(undefined, new URLSearchParams(""), TODAY).leader).toBeNull();
    expect(parseScorecardParams("   ", new URLSearchParams(""), TODAY).leader).toBeNull();
  });
});
