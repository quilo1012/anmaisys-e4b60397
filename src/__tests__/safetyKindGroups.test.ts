import { describe, expect, it } from "vitest";
import { SAFETY_KINDS, SAFETY_KIND_GROUPS, isHarmKind, safetyKindMeta } from "@/lib/qualityConstants";

/**
 * The safety form no longer has a Kind dropdown. It draws one button row per entry in
 * `SAFETY_KIND_GROUPS` and fills each row by filtering `SAFETY_KINDS` on that group,
 * which is a better form and a new way to lose a value: a kind belonging to a group
 * nobody renders is simply not on screen, and there is no empty row to notice.
 *
 * That matters more here than it would elsewhere. `safety_kind` is the only input to
 * seven of the nine H&S fields of the weekly scorecard (`scorecard_safety_counts`), so
 * a kind that cannot be picked is a scorecard field that can only ever read zero — and
 * zero lost-time injuries reads as a safe week, not as a missing button.
 */
describe("every safety kind is reachable on the form", () => {
  it("puts each kind in a group the form actually draws", () => {
    const drawn = new Set(SAFETY_KIND_GROUPS.map((g) => g.group));
    const orphans = SAFETY_KINDS.filter((k) => !drawn.has(k.group)).map((k) => k.value);
    expect(orphans).toEqual([]);
  });

  it("draws no empty group, which would be a heading over nothing", () => {
    for (const g of SAFETY_KIND_GROUPS) {
      expect(SAFETY_KINDS.filter((k) => k.group === g.group).length).toBeGreaterThan(0);
    }
  });

  it("opens with harm — a list starting at Toolbox talk invites the mildest fit", () => {
    expect(SAFETY_KIND_GROUPS[0].group).toBe("harm");
  });
});

/**
 * `isHarmKind` backs the "Harm reported" card that replaced "High / Critical open" on
 * the Safety tab. It has to agree with `scorecard_safety_counts`, which counts exactly
 * these three as consequences — and must never absorb `near_miss`, the leading signal
 * that migration 20260817090000 is explicit about never summing with first aid.
 */
describe("isHarmKind", () => {
  it("counts the three kinds the weekly scorecard counts as consequences", () => {
    expect(SAFETY_KINDS.filter((k) => isHarmKind(k.value)).map((k) => k.value).sort())
      .toEqual(["first_aid", "lost_time_injury", "reportable_accident"]);
  });

  it("never counts a near miss as harm", () => {
    expect(isHarmKind("near_miss")).toBe(false);
  });

  it("is false for an unclassified occurrence rather than throwing", () => {
    expect(isHarmKind(null)).toBe(false);
    expect(isHarmKind("")).toBe(false);
    expect(isHarmKind("not_a_kind")).toBe(false);
  });

  it("names the three the way the card prints them", () => {
    expect(["lost_time_injury", "reportable_accident", "first_aid"].map((k) => safetyKindMeta(k)?.label))
      .toEqual(["Lost-time injury", "Reportable accident", "First aid"]);
  });
});
