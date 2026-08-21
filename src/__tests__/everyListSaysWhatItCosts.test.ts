import { describe, it, expect } from "vitest";
import { listGroups, type QualityListGroup } from "@/lib/qualityListGroups";

/**
 * Every list in Lists & scoring says what it does to a leader's score, on itself.
 *
 * This exists because of a real, reported confusion: the Health & Safety list renders
 * with no points box, no gate switch and no attribution switch, and on the Quality tab
 * it rendered with no explanation either. The paragraph that said why — "hazards, not
 * scoring; a safety occurrence is counted and never charged" — was gated behind
 * `isSafety`, so it only ever appeared on the Safety tab's own copy of the manager.
 *
 * The quality manager therefore saw a list stripped of every control the list above it
 * had, and nothing on screen distinguishing "this list is not priced" from "the points
 * box is broken here". They reported it as broken. It was not broken; it was silent.
 *
 * A conditional paragraph could be re-broken by anyone adding a fourth group. Putting
 * the sentence ON the group makes it impossible to render a list without one: there is
 * no code path that draws a group and skips its own field.
 */

const DOMAINS = ["quality", "safety"] as const;

describe("every group carries its own scoring effect", () => {
  for (const domain of DOMAINS) {
    describe(`on the ${domain} tab`, () => {
      const groups = listGroups(domain);

      it("renders at least one group", () => {
        expect(groups.length).toBeGreaterThan(0);
      });

      it("gives every group a title and a sentence about the score", () => {
        for (const g of groups) {
          expect(g.title.trim()).not.toBe("");
          expect(g.effect.trim()).not.toBe("");
        }
      });
    });
  }

  it("says the same thing about Health & Safety on both tabs", () => {
    // The exact bug. The sentence was on the Safety tab and missing on the Quality
    // tab, so the same list meant two different things depending on how you got to it.
    const onQuality = listGroups("quality").find((g) => g.kind === "safety_label");
    const onSafety = listGroups("safety").find((g) => g.kind === "safety_label");
    expect(onQuality).toBeDefined();
    expect(onSafety).toBeDefined();
    expect(onQuality!.effect).toBe(onSafety!.effect);
    expect(onQuality!.title).toBe(onSafety!.title);
  });
});

describe("the columns a group declares match what it can actually do", () => {
  const byKind = (kind: QualityListGroup["kind"]) =>
    listGroups("quality").find((g) => g.kind === kind)!;

  it("prices quality actions, gates them, and attributes them", () => {
    expect(byKind("label").columns).toEqual({ points: true, gate: true, attribution: true });
  });

  it("prices Health & Safety, and gives it nothing else", () => {
    // It prices now, by an explicit decision recorded in qualityListGroups.ts. It still
    // cannot gate — no hazard turns a period Red by itself — and there is nothing to
    // re-attribute, because an occurrence is the leader's or it is worth nothing.
    expect(byKind("safety_label").columns).toEqual({ points: true, gate: false, attribution: false });
  });

  it("prices Maintenance and charges nobody for it", () => {
    // The one combination this screen did not have before: a live points box whose
    // number never reaches a scorecard. See CHARGING_LABEL_KINDS for the enforcement.
    expect(byKind("maintenance_label").columns).toEqual({ points: true, gate: false, attribution: false });
  });

  it("attributes departments, and prices nothing", () => {
    // A department answers "whose is this", never "what does it cost". Pricing one
    // would put a second, competing charge beside the labels'.
    expect(byKind("department").columns).toEqual({ points: false, gate: false, attribution: true });
  });
});

describe("the safety tab shows the hazard list and nothing else", () => {
  it("hides the quality lists, which a safety occurrence never touches", () => {
    expect(listGroups("safety").map((g) => g.kind)).toEqual(["safety_label"]);
  });

  it("shows all four on the quality tab, hazards and maintenance included", () => {
    expect(listGroups("quality").map((g) => g.kind))
      .toEqual(["label", "maintenance_label", "safety_label", "department"]);
  });
});
