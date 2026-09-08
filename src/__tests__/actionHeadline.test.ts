import { describe, it, expect } from "vitest";
import { actionHeadline, actionDetail } from "@/lib/qualityConstants";

/**
 * Two import sources, two different columns, one log that only drew one of them.
 *
 * Measured 08/09/2026: all 66 SafetyCulture rows carry `title` and no `action_no`,
 * only 14 carry a `description`; the 69 typed by hand are the mirror image. The table
 * drew `#` and Notes, so two thirds of the log was a page of dashes and every one of
 * those rows opened a dialog titled "Issue".
 */

describe("actionHeadline", () => {
  it("reads the title a SafetyCulture row identifies itself by", () => {
    expect(actionHeadline({ title: "Metal found on magnet (C2)", description: null }))
      .toBe("Metal found on magnet (C2)");
  });

  it("falls back to the description a hand-typed action puts it in", () => {
    expect(actionHeadline({ title: null, description: "Weight out of spec on Line 4" }))
      .toBe("Weight out of spec on Line 4");
  });

  it("prefers the title when a row has both", () => {
    expect(actionHeadline({ title: "Missing knife", description: "Blender 2 toolbox, night shift" }))
      .toBe("Missing knife");
  });

  it("treats whitespace as absent, in both fields", () => {
    expect(actionHeadline({ title: "   ", description: "Real note" })).toBe("Real note");
    expect(actionHeadline({ title: "  ", description: "  " })).toBeNull();
    expect(actionHeadline({})).toBeNull();
  });
});

describe("actionDetail", () => {
  it("gives the longer note when it adds something", () => {
    expect(actionDetail({ title: "Missing knife", description: "Blender 2 toolbox, night shift" }))
      .toBe("Blender 2 toolbox, night shift");
  });

  it("says nothing when the note IS the headline", () => {
    // Otherwise the dialog prints the same sentence twice, once as its heading and
    // once as a paragraph under it.
    expect(actionDetail({ title: null, description: "Weight out of spec" })).toBeNull();
    expect(actionDetail({ title: "Same text", description: "Same text" })).toBeNull();
  });

  it("says nothing when there is no note at all", () => {
    expect(actionDetail({ title: "Metal on magnet", description: null })).toBeNull();
  });
});
