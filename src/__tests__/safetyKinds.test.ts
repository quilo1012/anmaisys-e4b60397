import { describe, expect, it } from "vitest";
import { SAFETY_KINDS, safetyKindMeta } from "@/lib/qualityConstants";

describe("SAFETY_KINDS", () => {
  it("carries the seven kinds the log records", () => {
    expect(SAFETY_KINDS.map((k) => k.value)).toEqual([
      "lost_time_injury", "reportable_accident", "first_aid", "near_miss",
      "safety_observation", "toolbox_talk", "ppe_breach",
    ]);
  });

  it("keeps first aid and near miss in different groups", () => {
    // A consequence and a leading signal. Sharing a group is how they end up sharing a
    // total, and a total of the two answers no question anybody has.
    const firstAid = safetyKindMeta("first_aid");
    const nearMiss = safetyKindMeta("near_miss");
    expect(firstAid?.group).toBe("harm");
    expect(nearMiss?.group).toBe("signal");
  });

  it("groups the preventive activity apart from both", () => {
    expect(safetyKindMeta("toolbox_talk")?.group).toBe("prevention");
    expect(safetyKindMeta("safety_observation")?.group).toBe("prevention");
  });

  it("returns null for a value that is not a safety kind", () => {
    expect(safetyKindMeta("critical")).toBeNull();
    expect(safetyKindMeta(null)).toBeNull();
  });
});
