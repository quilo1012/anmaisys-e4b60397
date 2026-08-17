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
});
