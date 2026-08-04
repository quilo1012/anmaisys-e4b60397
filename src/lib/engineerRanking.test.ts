import { describe, it, expect } from "vitest";

/**
 * The engineer ranking, scored on the period being looked at.
 *
 * Mirrors the rule in AnalyticsPage. What it replaces: `engineer_scores.score`, a
 * lifetime accumulator clamped to 0–100 that was never recalculated. Because it
 * accumulated and stopped at 100, everybody reached the ceiling, where the rewards
 * did nothing and only the penalties still bit — on 04/08 seven engineers read
 * exactly 100 and one read 85, for a single missed response SLA at some unknown
 * point, on a day nobody had completed anything.
 */
const band = (value: number, target: number) =>
  Math.max(0, Math.min(50, Math.round(50 * (1 - (value - target) / (target * 3)))));

const score = (e: { completed: number; avgResponse: number; avgMTTR: number }) =>
  e.completed === 0 ? null : band(e.avgResponse, 30) + band(e.avgMTTR, 60);

describe("engineer score", () => {
  it("has nothing to say about somebody who completed nothing", () => {
    // Not zero. Zero accuses somebody of a bad month they did not have.
    expect(score({ completed: 0, avgResponse: 0, avgMTTR: 0 })).toBeNull();
    expect(score({ completed: 0, avgResponse: 999, avgMTTR: 999 })).toBeNull();
  });

  it("gives full marks at the target and better", () => {
    expect(score({ completed: 5, avgResponse: 30, avgMTTR: 60 })).toBe(100);
    expect(score({ completed: 5, avgResponse: 2, avgMTTR: 5 })).toBe(100);
  });

  it("falls away as the times pass the target", () => {
    const fast = score({ completed: 5, avgResponse: 30, avgMTTR: 60 })!;
    const middling = score({ completed: 5, avgResponse: 60, avgMTTR: 120 })!;
    const slow = score({ completed: 5, avgResponse: 110, avgMTTR: 220 })!;
    expect(fast).toBeGreaterThan(middling);
    expect(middling).toBeGreaterThan(slow);
  });

  it("bottoms out rather than going negative", () => {
    expect(score({ completed: 3, avgResponse: 5000, avgMTTR: 5000 })).toBe(0);
  });

  it("scores the two halves independently", () => {
    // Quick to answer, slow to fix — should not read the same as slow at both.
    const quickSlow = score({ completed: 4, avgResponse: 5, avgMTTR: 240 })!;
    const slowSlow = score({ completed: 4, avgResponse: 240, avgMTTR: 240 })!;
    expect(quickSlow).toBeGreaterThan(slowSlow);
    expect(quickSlow).toBe(50);
  });

  it("separates people the old accumulator tied at the ceiling", () => {
    // Seven engineers all read 100 before. Their real period figures differ, so
    // their scores must too.
    const a = score({ completed: 10, avgResponse: 12, avgMTTR: 40 })!;
    const b = score({ completed: 10, avgResponse: 75, avgMTTR: 150 })!;
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThan(b);
  });
});
