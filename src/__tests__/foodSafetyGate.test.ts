import { describe, it, expect } from "vitest";
import { computeLeaderScore, GATE_CAP } from "@/lib/leaderScore";
import { setSeverityPoints, setLabelPoints } from "@/lib/qualityConstants";

/**
 * The acceptance criterion, in the form it was written: a leader with every other
 * metric perfect and ONE action carrying Fail CCP closes the period at 49 or below.
 *
 * The point of the test is not the arithmetic — it is that no amount of good
 * production reaches this number. A ceiling applied after the weighted sum is the only
 * arrangement where that is structurally true, and this is what proves the ceiling did
 * not quietly become a weight.
 */

const GATES = new Set(["fail ccp", "foreign body", "wrong weight volume check", "bag inside blender"]);
const NOTHING_EXCLUDED = new Set<string>();

/** A period nothing is wrong with: full attainment, no actions. */
const perfect = (actions: Parameters<typeof computeLeaderScore>[0]["actions"]) => ({
  actual: 1000, target: 1000, avgOEE: 100, actions,
  excludedLabels: NOTHING_EXCLUDED, gateLabels: GATES,
});

const ccp = (over: Record<string, unknown> = {}) => ({
  domain: "quality", severity: "low", labels: ["Fail CCP"],
  validation_status: "open", recorded_at: "2026-07-12T09:00:00.000Z", ...over,
});

describe("one failed CCP ends the period", () => {
  it("caps a leader who is otherwise perfect", () => {
    setSeverityPoints({ low: 1, medium: 2, high: 3, critical: 4 });
    setLabelPoints({});
    const r = computeLeaderScore(perfect([ccp()]));
    expect(r.final).toBeLessThanOrEqual(GATE_CAP);
    expect(r.cap?.applied).toBe(true);
  });

  it("names what fired and the day it fired", () => {
    const r = computeLeaderScore(perfect([ccp()]));
    expect(r.cap?.reason).toContain("Fail Ccp");
    expect(r.cap?.reason).toContain("12/07");
    expect(r.cap?.reason).toContain("never a weight");
  });

  it("shows the score it was cut from, so the subtraction is checkable", () => {
    const r = computeLeaderScore(perfect([ccp()]));
    expect(r.cap?.weighted).toBeGreaterThan(GATE_CAP);
  });

  it("cannot be bought back by production, at any weighting", () => {
    // The whole design, asserted rather than described. Every weighting that sums to
    // 100 — including one that puts everything on Production — still lands on the cap.
    for (const w of [
      { production_pct: 100, quality_pct: 0, documentation_pct: 0 },
      { production_pct: 80, quality_pct: 10, documentation_pct: 10 },
      { production_pct: 40, quality_pct: 35, documentation_pct: 25 },
    ]) {
      expect(computeLeaderScore(perfect([ccp()]), w).final).toBeLessThanOrEqual(GATE_CAP);
    }
  });
});

describe("what does and does not fire it", () => {
  it("a rejected action does not gate — Quality looked and said it did not happen", () => {
    const r = computeLeaderScore(perfect([ccp({ validation_status: "rejected" })]));
    expect(r.cap).toBeNull();
    expect(r.final).toBeGreaterThan(GATE_CAP);
  });

  it("an unpriced, ungraded gate label still gates — it is not a number of points", () => {
    // The defect this change exists to fix, stated as a test: Fail CCP priced at 0 and
    // graded at nothing was worth 0 points and therefore invisible. It gates anyway.
    setLabelPoints({});
    const r = computeLeaderScore(perfect([ccp({ severity: null })]));
    expect(r.cap?.applied).toBe(true);
  });

  it("a completed CAPA does not erase it — closure is tracked elsewhere", () => {
    const r = computeLeaderScore(perfect([ccp({ validation_status: "validated", closed_at: "2026-07-20" })]));
    expect(r.cap?.applied).toBe(true);
  });

  it("still gates when the label is not the leader's — a gate is occurrence, not blame", () => {
    // Deliberate, and the most arguable line in the change. `actionPoints` asks whose
    // fault it was because it decides who pays; a gate asks only whether it happened.
    const r = computeLeaderScore({
      ...perfect([ccp({ labels: ["Fail CCP", "Maintenance"] })]),
      excludedLabels: new Set(["maintenance", "fail ccp"]),
    });
    expect(r.cap?.applied).toBe(true);
  });

  it("an ordinary action does not gate, however severe", () => {
    setSeverityPoints({ low: 1, medium: 2, high: 3, critical: 4 });
    const r = computeLeaderScore(perfect([ccp({ labels: ["Pallet"], severity: "critical" })]));
    expect(r.cap).toBeNull();
  });

  it("an empty gate set gates nothing — which is why the screens wait for it", () => {
    const r = computeLeaderScore({ ...perfect([ccp()]), gateLabels: new Set<string>() });
    expect(r.cap).toBeNull();
  });
});

describe("it shares one ceiling with Health & Safety", () => {
  it("a CCP and a lost-time injury in one period name both, and cap once", () => {
    const r = computeLeaderScore(perfect([
      ccp(),
      { domain: "safety", severity: null, labels: [], validation_status: "open", safety_kind: "lost_time_injury" },
    ]));
    expect(r.final).toBeLessThanOrEqual(GATE_CAP);
    expect(r.cap?.reason).toContain("lost-time injury");
    expect(r.cap?.reason).toContain("Fail Ccp");
  });
});
