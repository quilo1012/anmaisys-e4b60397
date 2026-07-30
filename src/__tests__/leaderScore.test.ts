import { describe, it, expect } from "vitest";
import { computeLeaderScore, displayScore, DEFAULT_WEIGHTS } from "@/lib/leaderScore";

const noActions: never[] = [];

describe("computeLeaderScore", () => {
  it("production is attainment, capped at 100", () => {
    const over = computeLeaderScore({ actual: 130, target: 100, avgOEE: null, actions: noActions });
    expect(over.production.value).toBe(100);
    const under = computeLeaderScore({ actual: 80, target: 100, avgOEE: null, actions: noActions });
    expect(under.production.value).toBe(80);
  });

  it("falls back to OEE when nothing was planned", () => {
    const r = computeLeaderScore({ actual: 0, target: 0, avgOEE: 72, actions: noActions });
    expect(r.production.value).toBe(72);
    expect(r.production.basis).toMatch(/no target/i);
  });

  it("every action that stands costs quality points, whatever its verdict so far", () => {
    // An action raised against the shift is a quality event while it is open. A
    // leader with an open action reading 100% is the number nobody believes twice.
    const open = [{ severity: "critical", validation_status: "open" }];
    expect(computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: open }).quality.value).toBe(96);

    const investigating = [{ severity: "high", validation_status: "under_investigation" }];
    expect(computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: investigating }).quality.value).toBe(97);

    const validated = [{ severity: "critical", validation_status: "validated" }];
    expect(computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: validated }).quality.value).toBe(96);
  });

  it("a rejected action is void — Quality looked and said it was not real", () => {
    const rejected = [{ severity: "critical", validation_status: "rejected" }];
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: rejected });
    expect(r.quality.value).toBe(100);
    expect(r.quality.basis).toMatch(/rejected/i);
  });

  it("documentation loses 5 per validated paperwork action, and nothing for the rest", () => {
    const actions = [
      { severity: "low", labels: ["Paperwork"], validation_status: "validated" },
      { severity: "low", labels: ["Paperwork"], validation_status: "validated" },
      { severity: "low", labels: ["Paperwork"], validation_status: "open" },
      { severity: "low", labels: ["Label"], validation_status: "validated" },
    ];
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions });
    expect(r.documentation.value).toBe(90);
  });

  it("weights the three components", () => {
    // Severity null → 0 quality points, so quality stays 100 and only documentation
    // moves: 100 production, 100 quality, 90 documentation at 40/30/30 → 97
    const actions = [
      { severity: null, labels: ["Paperwork"], validation_status: "validated" },
      { severity: null, labels: ["Paperwork"], validation_status: "validated" },
    ];
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions }, DEFAULT_WEIGHTS);
    expect(Math.round(r.final!)).toBe(97);
  });

  it("drops a component with no data and shares its weight, instead of scoring it zero", () => {
    // No target and no OEE: production cannot be measured. A leader with a clean
    // quality and documentation record must not be dragged to 60 by an absent plan.
    const r = computeLeaderScore({ actual: 0, target: 0, avgOEE: null, actions: noActions });
    expect(r.production.value).toBeNull();
    expect(r.final).toBe(100);
    expect(r.applied.production_pct).toBe(0);
    expect(r.applied.quality_pct + r.applied.documentation_pct).toBe(100);
  });
});

describe("displayScore", () => {
  it("rounds down, so a deduction can never round back to full marks", () => {
    // One Low action: quality 99, the other two 100 → 99.7 weighted. Shown as 100%
    // it read as a clean period with an action open on the board.
    const actions = [{ severity: "low", validation_status: "open" }];
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions });
    expect(r.final).toBeCloseTo(99.7, 1);
    expect(displayScore(r.final)).toBe(99);
  });

  it("leaves a genuine 100 alone", () => {
    const r = computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: [] });
    expect(displayScore(r.final)).toBe(100);
  });
});
