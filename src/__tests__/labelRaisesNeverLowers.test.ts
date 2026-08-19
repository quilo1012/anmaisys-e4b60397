import { describe, it, expect, beforeEach } from "vitest";
import {
  actionPoints, pointsBreakdown, maxLabelPoints, setMaxLabelPoints,
  setLabelPoints, setSeverityPoints, chargeSummary, logFormCharge,
} from "@/lib/qualityConstants";

/**
 * The acceptance criteria for "a label may aggravate, never soften", as written.
 *
 * Deliberately set up on the 0–20 scale the specification uses rather than the 1/2/3/4
 * this factory runs today, so the three criteria can be read here in the numbers they
 * were written in. The rule under test is scale-independent; pinning it to the scale in
 * force would have made these tests re-write themselves the day the scale moves, which
 * is a decision already taken and not yet applied.
 */

const EXCLUDED = new Set(["maintenance"]);
const q = (severity: string | null, labels: string[]) => ({
  domain: "quality", severity, labels, validation_status: "open",
});

beforeEach(() => {
  setSeverityPoints({ low: 1, medium: 5, high: 12, critical: 20 });
  setMaxLabelPoints(null);
});

describe("the three acceptance criteria", () => {
  it("Critical (20) carrying a label priced at 1 is worth 20 — it was worth 1", () => {
    setLabelPoints({ "batch code": 1 });
    expect(actionPoints(q("critical", ["Batch code"]), EXCLUDED)).toBe(20);
  });

  it("Low (1) carrying a label priced at 15 is worth 15", () => {
    setLabelPoints({ "foreign body": 15 });
    expect(actionPoints(q("low", ["Foreign Body"]), EXCLUDED)).toBe(15);
  });

  it("Critical (20) with labels summing 24 is worth 20 capped, 24 uncapped", () => {
    setLabelPoints({ "foreign body": 15, gmp: 9 });
    const action = q("critical", ["Foreign Body", "GMP"]);

    setMaxLabelPoints(20);
    expect(actionPoints(action, EXCLUDED)).toBe(20);

    setMaxLabelPoints(30);
    expect(actionPoints(action, EXCLUDED)).toBe(24);
  });
});

describe("the rule holds where it used to fail silently", () => {
  it("an unpriced action still falls through to its grade", () => {
    setLabelPoints({});
    expect(actionPoints(q("high", ["GMP"]), EXCLUDED)).toBe(12);
    expect(actionPoints(q("high", []), EXCLUDED)).toBe(12);
  });

  it("a spared label cannot drag the charge below the grade", () => {
    // The AC-6183 shape. Maintenance is not the leader's, Batch code charges 1, and
    // the action is Critical. Under the replace rule this leader was charged 1.
    setLabelPoints({ "batch code": 1, maintenance: 9 });
    expect(actionPoints(q("critical", ["Batch code", "Maintenance"]), EXCLUDED)).toBe(20);
  });

  it("safety is still worth nothing, however the labels are priced", () => {
    setLabelPoints({ "foreign body": 15 });
    expect(actionPoints({ ...q("critical", ["Foreign Body"]), domain: "safety" }, EXCLUDED)).toBe(0);
  });
});

describe("the ceiling ships off, so nobody's charge falls on the day it lands", () => {
  it("is uncapped until somebody sets it", () => {
    expect(maxLabelPoints()).toBe(Infinity);
  });

  it("does not quietly cut a label priced above the top grade", () => {
    // The specification asked for an initial ceiling equal to Critical's points. Here
    // that would have charged 15 for a Foreign Body priced at 25 — a food safety label
    // made cheaper as a side effect of adding a safety rail.
    setSeverityPoints({ low: 1, medium: 5, high: 12, critical: 15 });
    setLabelPoints({ "foreign body": 25 });
    expect(actionPoints(q("low", ["Foreign Body"]), EXCLUDED)).toBe(25);
  });
});

describe("the card says which of the two won", () => {
  it("names the grade when the grade wins, and what the labels would have charged", () => {
    setLabelPoints({ "batch code": 1 });
    const b = pointsBreakdown(q("critical", ["Batch code"]), EXCLUDED);
    expect(b.basis).toBe("severity_over_labels");
    expect(b.points).toBe(20);
    expect(b.explanation).toContain("Critical");
    expect(b.explanation).toContain("Batch code 1");
    expect(b.explanation).toContain("never lower it");
  });

  it("names the labels when the labels win", () => {
    setLabelPoints({ "foreign body": 15 });
    const b = pointsBreakdown(q("low", ["Foreign Body"]), EXCLUDED);
    expect(b.basis).toBe("labels");
    expect(b.explanation).toBe("15 points — Foreign Body 15.");
  });

  it("says so when the ceiling is what decided the number", () => {
    setLabelPoints({ "foreign body": 15, gmp: 9 });
    setMaxLabelPoints(20);
    const b = pointsBreakdown(q("low", ["Foreign Body", "GMP"]), EXCLUDED);
    expect(b.points).toBe(20);
    expect(b.explanation).toContain("capped at 20");
  });
});

describe("the sentence the log form shows before Save", () => {
  const summary = (severity: string | null, labels: string[]) =>
    chargeSummary(logFormCharge(labels, EXCLUDED), severity);

  it("no longer tells somebody their Critical action scores 0", () => {
    // The sentence that made the old rule invisible, on the screen where the action is
    // created: "No priced label — this action scores 0." beside a Critical grade.
    setLabelPoints({});
    expect(summary("critical", ["GMP"])).toBe("Charged 20p — the Critical grade. No priced label.");
  });

  it("still says plainly that an ungraded, unpriced action scores nothing", () => {
    // Unchanged, and it must be: this is the honest zero, and it is the case that cost
    // leaders deviations they had logged in good faith.
    setLabelPoints({});
    expect(summary(null, ["GMP"])).toBe("No priced label — this action scores 0.");
  });

  it("names both sides when the grade outranks the labels", () => {
    setLabelPoints({ "batch code": 1 });
    expect(summary("critical", ["Batch code"]))
      .toBe("Charged 20p — the Critical grade. Its labels charge 1, and a label can only raise a charge.");
  });

  it("leaves the labels in charge when they outrank the grade", () => {
    setLabelPoints({ "foreign body": 15 });
    expect(summary("low", ["Foreign Body"])).toContain("15p");
  });
});
