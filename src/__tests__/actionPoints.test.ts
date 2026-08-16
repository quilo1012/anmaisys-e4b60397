import { describe, it, expect } from "vitest";
import { actionPoints, sumActionPoints, countsAgainstLeader } from "@/lib/qualityConstants";
import { leaderTracking } from "@/lib/leaderTracking";
import { computeLeaderScore } from "@/lib/leaderScore";
import { leaderPointsBreakdown } from "@/lib/qualityBreakdown";
import { linePointsBreakdown } from "@/lib/qualityBreakdown";

/**
 * The acceptance criterion for the points refactor, written as a number rather than
 * an opinion: Cainan scores the same on every surface that shows him a total.
 *
 * He is the leader worth testing because he carries both awkward shapes at once — an
 * action Quality rejected, and an action whose labels are split between his and
 * maintenance's. Before this refactor the four surfaces gave four different answers
 * for exactly that combination.
 */

/** Quality has marked Maintenance as not the leader's to answer for. */
const EXCLUDED = new Set(["maintenance"]);

const CAINAN = [
  // Plainly his: one attributable label, validated by Quality. 4 points.
  {
    leader_name: "Cainan", line: "Line 1", shift: "DAY", severity: "critical",
    labels: ["Batch code"], validation_status: "validated", closed_at: null,
  },
  // Quality looked and said it was not a deviation. Costs nothing, anywhere.
  {
    leader_name: "Cainan", line: "Line 1", shift: "DAY", severity: "critical",
    labels: ["Batch code"], validation_status: "rejected", closed_at: null,
  },
  // Maintenance alone — the machine's, not his. Costs nothing.
  {
    leader_name: "Cainan", line: "Line 2", shift: "DAY", severity: "high",
    labels: ["Maintenance"], validation_status: "validated", closed_at: null,
  },
  // The AC-6183 shape: one excluded label, one attributable. Under the rule chosen
  // here, one attributable label is enough, so this counts. 3 points.
  {
    leader_name: "Cainan", line: "Line 2", shift: "DAY", severity: "high",
    labels: ["Batch code", "Maintenance"], validation_status: "open", closed_at: null,
  },
];

/** 4 (critical, his) + 0 (rejected) + 0 (maintenance) + 3 (high, mixed labels). */
const CAINAN_POINTS = 7;

describe("actionPoints — the single definition", () => {
  it("weighs severity, and voids what is not his", () => {
    const [his, rejected, maintenance, mixed] = CAINAN;
    expect(actionPoints(his, EXCLUDED)).toBe(4);
    expect(actionPoints(rejected, EXCLUDED)).toBe(0);
    expect(actionPoints(maintenance, EXCLUDED)).toBe(0);
    expect(actionPoints(mixed, EXCLUDED)).toBe(3);
    expect(sumActionPoints(CAINAN, EXCLUDED)).toBe(CAINAN_POINTS);
  });

  it("an action with no labels still counts", () => {
    // Otherwise leaving the labels blank quietly removes a deviation from a score.
    expect(countsAgainstLeader({ labels: [] }, EXCLUDED)).toBe(true);
    expect(countsAgainstLeader({ labels: null }, EXCLUDED)).toBe(true);
  });

  it("one attributable label is enough — the rule restored on purpose", () => {
    // This is the AC-6183 trade-off, asserted so nobody flips it back by accident:
    // a veto rule would make this false, and would let anyone clear a genuine error
    // by adding Maintenance to it, with nothing on the total to show it happened.
    expect(countsAgainstLeader({ labels: ["Batch code", "Maintenance"] }, EXCLUDED)).toBe(true);
    expect(countsAgainstLeader({ labels: ["Maintenance"] }, EXCLUDED)).toBe(false);
  });

  it("an empty exclusion set charges everything — which is why loading must not render", () => {
    // The failure this guards: attribution arrives late, the screen paints 10 with an
    // empty set, then snaps to 7. Callers gate on `ready`; this states the reason.
    expect(sumActionPoints(CAINAN, new Set())).toBe(10);
    expect(sumActionPoints(CAINAN, EXCLUDED)).toBe(CAINAN_POINTS);
  });
});

describe("Cainan reads the same on every surface", () => {
  it("the leader table", () => {
    const row = leaderTracking(CAINAN, EXCLUDED).find((r) => r.leader === "Cainan");
    expect(row?.points).toBe(CAINAN_POINTS);
  });

  it("the by-leader chart", () => {
    const row = leaderPointsBreakdown(CAINAN, EXCLUDED).find((r) => r.label === "Cainan");
    expect(row?.points).toBe(CAINAN_POINTS);
  });

  it("the scorecard", () => {
    const score = computeLeaderScore({
      actual: 100, target: 100, avgOEE: null,
      actions: CAINAN, excludedLabels: EXCLUDED,
    });
    // Quality is 100 less the points that stand against him.
    expect(score.quality.value).toBe(100 - CAINAN_POINTS);
  });

  it("the line indicators, summed across his lines", () => {
    const byLine = linePointsBreakdown(CAINAN, EXCLUDED);
    const total = byLine.reduce((sum, l) => sum + l.qualityPoints, 0);
    expect(total).toBe(CAINAN_POINTS);
    // And the split is per line, not smeared: Line 1 keeps only the validated
    // critical, Line 2 only the mixed-label high.
    expect(byLine.find((l) => l.line === "Line 1")?.qualityPoints).toBe(4);
    expect(byLine.find((l) => l.line === "Line 2")?.qualityPoints).toBe(3);
  });

  it("no surface disagrees with any other", () => {
    // The criterion stated directly: if this fails, a copy of the rule survived.
    const table = leaderTracking(CAINAN, EXCLUDED).find((r) => r.leader === "Cainan")!.points;
    const chart = leaderPointsBreakdown(CAINAN, EXCLUDED).find((r) => r.label === "Cainan")!.points;
    const scorecard = 100 - computeLeaderScore({
      actual: 100, target: 100, avgOEE: null, actions: CAINAN, excludedLabels: EXCLUDED,
    }).quality.value!;
    const indicators = linePointsBreakdown(CAINAN, EXCLUDED).reduce((s, l) => s + l.qualityPoints, 0);

    expect(new Set([table, chart, scorecard, indicators])).toEqual(new Set([CAINAN_POINTS]));
  });
});

describe("safety never charges the leader", () => {
  const excluded = new Set<string>();

  it("scores zero however severe it was", () => {
    expect(actionPoints({ domain: "safety", severity: "critical", labels: [] }, excluded)).toBe(0);
  });

  it("scores zero even when a priced label would have charged", () => {
    // A priced label outranks severity in the quality path. It must not reach across
    // into safety and charge for a near miss.
    expect(actionPoints({ domain: "safety", severity: null, labels: ["Batch code"] }, excluded)).toBe(0);
  });

  it("still charges a quality action the same as before", () => {
    expect(actionPoints({ domain: "quality", severity: "critical", labels: [] }, excluded)).toBe(4);
  });

  it("treats a row with no domain as quality, so nothing already logged changes", () => {
    expect(actionPoints({ severity: "critical", labels: [] }, excluded)).toBe(4);
  });
});
