import { describe, it, expect } from "vitest";
import { mergeLabels } from "../../supabase/functions/_shared/safetyculture/normalize";

/**
 * A re-run must add the label it already knows.
 *
 * `buildRecord` merges the matched rule's label into whatever the action arrived with.
 * `safetyculture-classify` calls the same `classify()`, gets the same `cls.label` — and
 * throws it away: its update payload carries `error_type`, `department` and `severity`
 * and no `labels` at all.
 *
 * So a rule created after an action was imported never reaches it. That is exactly what
 * happened to nine actions raised between 02 and 04 September: the four DOCUMENTATION
 * rules that name them were created on the 6th, are active, carry `label = 'Paperwork'`,
 * and their regexes match the titles. Re-running the classifier would have changed
 * their error_type and left them unlabelled, and the Documentation pillar went on
 * handing those leaders full marks for a judgement nobody made.
 *
 * One function decides labels now, and both paths call it — because two places deciding
 * the same thing is how they came to disagree in the first place.
 */
describe("mergeLabels", () => {
  it("adds the rule's label to what the action already carried", () => {
    expect(mergeLabels(["Foreign Body"], "Paperwork")).toEqual(["Foreign Body", "Paperwork"]);
  });

  it("labels an action that arrived with none — the nine of September", () => {
    expect(mergeLabels([], "Paperwork")).toEqual(["Paperwork"]);
    expect(mergeLabels(null, "Paperwork")).toEqual(["Paperwork"]);
  });

  it("never removes a label that is already there", () => {
    // The whole point of merging rather than replacing. `standsAgainstLeader` reads
    // labels for attribution, so dropping one silently moves an action off somebody's
    // account with nothing on the card to say it happened.
    expect(mergeLabels(["Maintenance", "CCP"], null)).toEqual(["Maintenance", "CCP"]);
    expect(mergeLabels(["Maintenance"], "Paperwork")).toEqual(["Maintenance", "Paperwork"]);
  });

  it("does not duplicate a label the action already has, whatever the casing", () => {
    expect(mergeLabels(["Paperwork"], "Paperwork")).toEqual(["Paperwork"]);
    expect(mergeLabels(["paperwork"], "Paperwork")).toEqual(["paperwork"]);
    expect(mergeLabels(["PAPERWORK"], "paperwork")).toEqual(["PAPERWORK"]);
  });

  it("trims, and drops blanks rather than storing an empty label", () => {
    expect(mergeLabels(["  Foreign Body  "], "  Paperwork ")).toEqual(["Foreign Body", "Paperwork"]);
    expect(mergeLabels(["", "   "], "Paperwork")).toEqual(["Paperwork"]);
    expect(mergeLabels(["CCP"], "")).toEqual(["CCP"]);
  });

  it("keeps the action's own labels first, in the order they arrived", () => {
    // The rule's label goes last: a reader scanning the column sees what SafetyCulture
    // said before what the rules inferred.
    expect(mergeLabels(["GMP", "Label"], "Paperwork")).toEqual(["GMP", "Label", "Paperwork"]);
  });

  it("de-duplicates within the action's own labels too", () => {
    expect(mergeLabels(["CCP", "ccp", "CCP "], null)).toEqual(["CCP"]);
  });

  it("returns a fresh array and does not mutate the input", () => {
    const existing = ["CCP"];
    const out = mergeLabels(existing, "Paperwork");
    expect(existing).toEqual(["CCP"]);
    expect(out).not.toBe(existing);
  });
});
