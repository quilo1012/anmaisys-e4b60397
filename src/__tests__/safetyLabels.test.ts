import { describe, expect, it } from "vitest";
import { QUALITY_LABELS, SAFETY_LABELS, labelsForDomain } from "@/lib/qualityConstants";

describe("SAFETY_LABELS", () => {
  it("names the eight hazards a safety occurrence is logged against", () => {
    expect([...SAFETY_LABELS]).toEqual([
      "Slip / trip / fall",
      "Manual handling",
      "Machine guarding",
      "PPE",
      "Chemical / COSHH",
      "Forklift / traffic",
      "Housekeeping",
      "Electrical",
    ]);
  });

  it("leaves the quality list alone", () => {
    // The two forms share one table and one log; they must never share one vocabulary.
    expect([...QUALITY_LABELS]).toContain("Foreign Body");
    expect([...QUALITY_LABELS]).not.toContain("PPE");
    expect([...SAFETY_LABELS]).not.toContain("Foreign Body");
  });
});

describe("labelsForDomain", () => {
  const lists = { labels: ["CCP", "GMP"], safetyLabels: ["PPE", "Housekeeping"] };

  it("gives the safety form the safety list", () => {
    expect(labelsForDomain("safety", lists)).toEqual(["PPE", "Housekeeping"]);
  });

  it("gives every other domain the quality list", () => {
    expect(labelsForDomain("quality", lists)).toEqual(["CCP", "GMP"]);
    // A row written before the `domain` column existed is quality — see domainOf.
    expect(labelsForDomain(null, lists)).toEqual(["CCP", "GMP"]);
  });

  it("keeps a label the action already carries, whichever list it came from", () => {
    // Editing a safety occurrence logged before this split must not silently drop the
    // quality label it was saved with: the chip has to be there to be untickable.
    expect(labelsForDomain("safety", lists, ["GMP"])).toEqual(["PPE", "Housekeeping", "GMP"]);
  });

  it("does not repeat a label that is already in the list", () => {
    expect(labelsForDomain("safety", lists, ["PPE"])).toEqual(["PPE", "Housekeeping"]);
  });

  it("falls back to the constants when the configured list is empty", () => {
    expect(labelsForDomain("safety", { labels: [], safetyLabels: [] })).toEqual([...SAFETY_LABELS]);
    expect(labelsForDomain("quality", {})).toEqual([...QUALITY_LABELS]);
  });
});
