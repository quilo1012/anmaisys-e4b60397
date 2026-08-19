import { describe, expect, it, afterEach } from "vitest";
import { chargeSummary, excludedLabelNote, logFormCharge, setLabelPoints } from "@/lib/qualityConstants";

/**
 * The sentence under the labels, which is now the ONLY place the log form says what
 * the action will cost.
 *
 * Severity and Points came off the form because `actionPoints()` mostly ignored them:
 * the labels price the action. That is defensible — but only if the screen says so
 * before Save, including when the answer is zero. A silent zero is how a leader's
 * scorecard quietly loses a deviation that was logged in good faith.
 */

const NOTHING_EXCLUDED = new Set<string>();
const WEIGHTS = { low: 1, medium: 3, high: 4, critical: 5 };

afterEach(() => setLabelPoints({}));

describe("chargeSummary", () => {
  it("says plainly that an action no label prices scores nothing", () => {
    setLabelPoints({ "foreign body": 5 });
    const charge = logFormCharge(["Batch code"], NOTHING_EXCLUDED, WEIGHTS);
    expect(chargeSummary(charge)).toBe("No priced label — this action scores 0.");
  });

  it("says the same when nothing is ticked at all", () => {
    const charge = logFormCharge([], NOTHING_EXCLUDED, WEIGHTS);
    expect(chargeSummary(charge)).toBe("No priced label — this action scores 0.");
  });

  it("leads with the number and the grade, then where they came from", () => {
    setLabelPoints({ "foreign body": 5 });
    const charge = logFormCharge(["Foreign Body"], NOTHING_EXCLUDED, WEIGHTS);
    expect(chargeSummary(charge)).toBe("Charged 5p (Critical) — Foreign Body 5p.");
  });

  it("names every priced label when more than one charges", () => {
    setLabelPoints({ gmp: 3, "batch code": 1 });
    const charge = logFormCharge(["GMP", "Batch code"], NOTHING_EXCLUDED, WEIGHTS);
    expect(chargeSummary(charge)).toBe("Charged 4p (High) — GMP 3p + Batch code 1p.");
  });

  it("says ungraded rather than guessing when the total is worth no severity", () => {
    // 5 + 3 = 8 and nothing is worth 8. The action still costs 8; it just has no grade.
    setLabelPoints({ "foreign body": 5, gmp: 3 });
    const charge = logFormCharge(["Foreign Body", "GMP"], NOTHING_EXCLUDED, WEIGHTS);
    expect(chargeSummary(charge)).toBe(
      "Charged 8p, ungraded — no severity is worth 8p. Foreign Body 5p + GMP 3p.",
    );
  });

  it("prices by the labels that count, not the ones that were ticked", () => {
    setLabelPoints({ maintenance: 3, "foreign body": 5 });
    const charge = logFormCharge(["Maintenance", "Foreign Body"], new Set(["maintenance"]), WEIGHTS);
    expect(chargeSummary(charge)).toBe("Charged 5p (Critical) — Foreign Body 5p.");
  });
});

describe("excludedLabelNote", () => {
  it("names the ticked label that will not count toward this leader", () => {
    expect(excludedLabelNote(["Maintenance", "Foreign Body"], new Set(["maintenance"]))).toBe(
      "Maintenance is not this leader's — it will not count toward their score.",
    );
  });

  it("names all of them rather than saying 'some labels'", () => {
    expect(excludedLabelNote(["Maintenance", "Office", "GMP"], new Set(["maintenance", "office"]))).toBe(
      "Maintenance and Office are not this leader's — they will not count toward their score.",
    );
  });

  it("says nothing when every ticked label counts", () => {
    expect(excludedLabelNote(["GMP"], new Set(["maintenance"]))).toBeNull();
  });

  it("says nothing when no label is ticked", () => {
    expect(excludedLabelNote([], new Set(["maintenance"]))).toBeNull();
  });
});
