import { describe, expect, it, afterEach } from "vitest";
import { logFormCharge, setLabelPoints } from "@/lib/qualityConstants";

/**
 * What the Points box on the log form must show.
 *
 * The rule it has to obey is `actionPoints`, not its own: whatever this box says is
 * what the leader will be charged. It used to be wired to the severity alone, so with
 * a priced label selected the form said 4 and the system charged 5.
 */

const NOTHING_EXCLUDED = new Set<string>();

/** Label prices are module state — leave the next test the unpriced default. */
afterEach(() => setLabelPoints({}));

describe("logFormCharge", () => {
  it("leaves severity in charge while no selected label carries a price", () => {
    setLabelPoints({ "foreign body": 5 });
    const r = logFormCharge(["Batch code", "GMP"], NOTHING_EXCLUDED);
    expect(r.pricedByLabels).toBe(false);
    expect(r.points).toBe(0);
  });

  it("takes over from severity as soon as one selected label is priced", () => {
    setLabelPoints({ "foreign body": 5 });
    const r = logFormCharge(["Foreign Body"], NOTHING_EXCLUDED);
    expect(r.pricedByLabels).toBe(true);
    expect(r.points).toBe(5);
  });

  it("adds the priced labels up, because that is what the action will cost", () => {
    setLabelPoints({ "foreign body": 5, gmp: 3 });
    const r = logFormCharge(["Foreign Body", "GMP", "Batch code"], NOTHING_EXCLUDED);
    expect(r.points).toBe(8);
    expect(r.sources).toEqual([
      { label: "Foreign Body", points: 5 },
      { label: "GMP", points: 3 },
    ]);
  });

  it("skips a label that is not the leader's to answer for, exactly as the score does", () => {
    // Maintenance is excluded from attribution, so it does not price the action
    // either — otherwise the exclusion would come back in through the points.
    setLabelPoints({ maintenance: 3, "foreign body": 5 });
    const r = logFormCharge(["Maintenance", "Foreign Body"], new Set(["maintenance"]));
    expect(r.points).toBe(5);
    expect(r.sources).toEqual([{ label: "Foreign Body", points: 5 }]);
  });

  it("is unpriced when nothing is selected at all", () => {
    setLabelPoints({ "foreign body": 5 });
    const r = logFormCharge([], NOTHING_EXCLUDED);
    expect(r.pricedByLabels).toBe(false);
    expect(r.points).toBe(0);
    expect(r.sources).toEqual([]);
  });

  it("ignores a label priced at zero — unpriced is not a price of nothing", () => {
    setLabelPoints({ "batch code": 0 });
    expect(logFormCharge(["Batch code"], NOTHING_EXCLUDED).pricedByLabels).toBe(false);
  });

  /**
   * The severity the price names, so ticking one label fills both boxes.
   *
   * The weights in force here are the factory's: Low 1, Medium 3, High 4, Critical 5.
   */
  const WEIGHTS = { low: 1, medium: 3, high: 4, critical: 5 };

  it("names the severity the price is worth, so one tick fills both boxes", () => {
    setLabelPoints({ "foreign body": 5, gmp: 3 });
    expect(logFormCharge(["Foreign Body"], NOTHING_EXCLUDED, WEIGHTS).severity).toBe("critical");
    expect(logFormCharge(["GMP"], NOTHING_EXCLUDED, WEIGHTS).severity).toBe("medium");
  });

  it("leaves severity empty when the total is a number no severity carries", () => {
    // 5 + 3 = 8, and nothing is worth 8. Empty is the honest answer: the action is
    // worth 8 and 8 has no name. Guessing a neighbouring severity would put a grade
    // on the card that nobody chose.
    setLabelPoints({ "foreign body": 5, gmp: 3 });
    const r = logFormCharge(["Foreign Body", "GMP"], NOTHING_EXCLUDED, WEIGHTS);
    expect(r.points).toBe(8);
    expect(r.severity).toBe("");
  });

  it("names no severity when the labels do not price the action", () => {
    // The form keeps whatever severity the user picked; this must not clear it.
    expect(logFormCharge(["Batch code"], NOTHING_EXCLUDED, WEIGHTS).severity).toBeNull();
  });
});
