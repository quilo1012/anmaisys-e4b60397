import { describe, expect, it } from "vitest";
import { leaderTracking } from "@/lib/leaderTracking";
import { leaderPointsBreakdown, linePointsBreakdown } from "@/lib/qualityBreakdown";
import { actionPoints as actionPointsOf } from "@/lib/qualityConstants";

/**
 * The exact failure Critical 4 of the fix-wave review named: `leaderTracking` and
 * `leaderPointsBreakdown` count every row they are handed, and `actionPoints` prices
 * every safety row at 0 — so once two leaders are tied on points, the tie-break falls
 * to a raw count, and whoever reported the most near misses climbs the ranking.
 *
 * Neither function is supposed to guard against this itself — `standsAgainstLeader`
 * and `actionPoints` decide what counts and what it is worth, and both correctly say
 * "nothing" for a safety row. The guard has to be at the CALL SITE: the screen must
 * filter safety out of what it hands these two before ranking anyone. This test
 * proves the failure mode exists when that filter is skipped, and that filtering to
 * the quality-only subset — exactly what `QualityActionsPage` now does before
 * rendering either card — restores the correct order.
 */

const EXCLUDED = new Set<string>();

// Tied on quality: one Low action each, nothing validated differently. Alone, this
// pair does not decide who ranks first between them without a further tie-break.
const MARCIO = { leader_name: "Marcio", shift: "DAY", severity: "low", labels: [], validation_status: "validated", closed_at: null, domain: "quality" };
const AILTON_QUALITY = { leader_name: "Ailton", shift: "DAY", severity: "low", labels: [], validation_status: "validated", closed_at: null, domain: "quality" };

// Ailton also filed five near misses — exactly the behaviour this feature exists to
// encourage, and exactly what must never move his place in a quality ranking.
const AILTON_SAFETY = Array.from({ length: 5 }, () => ({
  leader_name: "Ailton", shift: "DAY", severity: null, labels: [],
  validation_status: "open", closed_at: null, domain: "safety",
}));

describe("an unfiltered mixed list lets safety reports invert a quality ranking", () => {
  it("leaderTracking: Ailton's near misses inflate his total past a points tie", () => {
    const unfiltered = leaderTracking([MARCIO, AILTON_QUALITY, ...AILTON_SAFETY], EXCLUDED);
    const ailton = unfiltered.find((r) => r.leader === "Ailton")!;
    // Both score 1 quality point — safety prices at 0 — so the count is what moves.
    expect(ailton.points).toBe(1);
    expect(ailton.total).toBe(6);
    // The bug, stated directly: reporting more near misses put him first.
    expect(unfiltered[0].leader).toBe("Ailton");
  });

  it("filtered to quality-only first — what the screen actually does — Ailton's total reads 1, not 6", () => {
    const qualityOnly = [MARCIO, AILTON_QUALITY].filter((a) => a.domain !== "safety");
    const rows = leaderTracking(qualityOnly, EXCLUDED);
    const ailton = rows.find((r) => r.leader === "Ailton")!;
    expect(ailton.total).toBe(1);
  });

  it("leaderPointsBreakdown shows the same inversion when fed the same unfiltered list", () => {
    const unfiltered = leaderPointsBreakdown([MARCIO, AILTON_QUALITY, ...AILTON_SAFETY], EXCLUDED);
    const ailton = unfiltered.find((r) => r.label === "Ailton")!;
    expect(ailton.points).toBe(1);
    expect(ailton.count).toBe(6);
    expect(unfiltered[0].label).toBe("Ailton");
  });

  it("leaderPointsBreakdown filtered to quality-only reads Ailton's count as 1", () => {
    const qualityOnly = [MARCIO, AILTON_QUALITY].filter((a) => a.domain !== "safety");
    const rows = leaderPointsBreakdown(qualityOnly, EXCLUDED);
    const ailton = rows.find((r) => r.label === "Ailton")!;
    expect(ailton.count).toBe(1);
  });
});

/**
 * The same inversion, on a line instead of a leader: `linePointsBreakdown`'s
 * `qualityPoints` is already 0 for a safety row, but its `openActions` count is a
 * plain row count with no domain awareness — it breaks down whatever list it is
 * given, it does not decide what belongs in that list (see the function's own
 * doc comment). `LineIndicators.tsx` used to hand it the raw `quality` query result,
 * so three reported near misses on a line showed as three open quality actions on a
 * quality indicator. The fix filters at the call site, the same ruling already
 * applied to `qualityOnly` in QualityActionsPage. Direct coverage of the call site
 * itself is by inspection — see the `qualityOnly` filter added in LineIndicators.tsx
 * immediately before its `linePointsBreakdown` call.
 */
describe("linePointsBreakdown: openActions must not count safety rows", () => {
  const EXCLUDED = new Set<string>();
  const ONE_QUALITY_ACTION = {
    line: "Line 1", severity: "low", labels: [], validation_status: "open", closed_at: null, domain: "quality",
  };
  const THREE_SAFETY_NEAR_MISSES = Array.from({ length: 3 }, () => ({
    line: "Line 1", severity: null, labels: [], validation_status: "open", closed_at: null, domain: "safety",
  }));

  it("fed the unfiltered list, near misses inflate the line's open-action count", () => {
    const unfiltered = linePointsBreakdown([ONE_QUALITY_ACTION, ...THREE_SAFETY_NEAR_MISSES], EXCLUDED);
    const line1 = unfiltered.find((l) => l.line === "Line 1")!;
    // The safety rows still price at 0 — actionPoints() already handles that.
    expect(line1.qualityPoints).toBe(actionPointsOf(ONE_QUALITY_ACTION, EXCLUDED));
    expect(line1.openActions).toBe(4); // the bug, stated directly
  });

  it("fed the quality-only list — what the call site now does — the count reads 1", () => {
    const qualityOnly = [ONE_QUALITY_ACTION, ...THREE_SAFETY_NEAR_MISSES].filter((a) => a.domain !== "safety");
    const rows = linePointsBreakdown(qualityOnly, EXCLUDED);
    const line1 = rows.find((l) => l.line === "Line 1")!;
    expect(line1.openActions).toBe(1);
  });
});
