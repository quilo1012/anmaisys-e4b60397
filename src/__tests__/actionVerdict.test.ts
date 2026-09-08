import { describe, it, expect } from "vitest";
import { belongsToProduction, onlyProduction, setAside } from "@/lib/actionVerdict";

/**
 * The Quality screen and the SafetyCulture screen counting the same rows.
 *
 * They disagreed because only one of them read `classification`: the settings screen
 * reported 29 line + 3 leader + 4 quality error + 12 needs review + 18 excluded, and
 * the Quality screen counted all of them, put the twenty-two it cannot attribute into
 * `Unassigned`, and made it the largest row of the leader table.
 */

const row = (classification: string | null) => ({ classification });

describe("belongsToProduction", () => {
  it("keeps what a line or a leader answers for", () => {
    expect(belongsToProduction(row("line"))).toBe(true);
    expect(belongsToProduction(row("leader"))).toBe(true);
  });

  it("keeps needs_review — an unproven check is not a verdict of not-ours", () => {
    // These are the queue of work that closes the gaps. Hiding them would hide the
    // only reason the verdicts screen exists.
    expect(belongsToProduction(row("needs_review"))).toBe(true);
  });

  it("drops what was raised outside Production", () => {
    expect(belongsToProduction(row("excluded"))).toBe(false);
  });

  it("drops Quality's own errors — no production leader answers for one", () => {
    expect(belongsToProduction(row("quality_error"))).toBe(false);
  });

  it("keeps a row nobody classified", () => {
    // `classification` is written only by the sync. The actions typed by hand on this
    // screen carry NULL forever, and reading NULL as "hide it" empties the log of
    // everything the factory entered itself.
    expect(belongsToProduction(row(null))).toBe(true);
    expect(belongsToProduction({})).toBe(true);
  });
});

describe("onlyProduction", () => {
  it("leaves the line's, the leader's and the unproven, and nothing else", () => {
    const all = [row("line"), row("excluded"), row("leader"), row("quality_error"), row("needs_review"), row(null)];
    expect(onlyProduction(all).map((a) => a.classification))
      .toEqual(["line", "leader", "needs_review", null]);
  });
});

describe("setAside", () => {
  it("says how many went, and why, so the two screens can be reconciled", () => {
    const all = [
      ...Array.from({ length: 18 }, () => row("excluded")),
      ...Array.from({ length: 4 }, () => row("quality_error")),
      ...Array.from({ length: 44 }, () => row("line")),
    ];
    expect(setAside(all)).toEqual({ excluded: 18, qualityError: 4, total: 22 });
    expect(onlyProduction(all)).toHaveLength(44);
  });

  it("counts nothing when nothing was set aside", () => {
    expect(setAside([row("line"), row(null)])).toEqual({ excluded: 0, qualityError: 0, total: 0 });
  });
});
