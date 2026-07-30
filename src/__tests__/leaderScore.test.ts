import { describe, it, expect } from "vitest";
import { computeLeaderScore, DEFAULT_WEIGHTS } from "@/lib/leaderScore";

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

  it("only validated actions cost quality points", () => {
    const actions = [
      { severity: "critical", validation_status: "open" },
      { severity: "critical", validation_status: "under_investigation" },
      { severity: "critical", validation_status: "rejected" },
    ];
    expect(computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions }).quality.value).toBe(100);

    const validated = [{ severity: "critical", validation_status: "validated" }];
    // Critical is 4 severity points by default.
    expect(computeLeaderScore({ actual: 100, target: 100, avgOEE: null, actions: validated }).quality.value).toBe(96);
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
    // 100 production, 100 quality, 90 documentation at 40/30/30 → 97
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
