import { describe, it, expect } from "vitest";
import { resolveLineName } from "@/lib/ragLayoutParser";

/** The lines the factory actually has, exactly as the database spells them. */
const LINES = [
  "Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Line 6",
  "Tablet Line", "GEL Line", "Capsules Machine 1", "Capsules Machine 2",
];

describe("resolveLineName", () => {
  it("sends every tablet and capsule heading to Tablet Line", () => {
    for (const heading of [
      "Tablet", "Tablets", "Tablet Line", "Tablets Line",
      "Capsule", "Capsules", "Capsule Line", "Capsules Line",
      "Caps & Tabs", "C&T",
    ]) {
      expect(resolveLineName(heading, LINES), heading).toBe("Tablet Line");
    }
  });

  it("matches GEL Line despite the capitals", () => {
    // The alias said "Gel Line" and the database says "GEL Line". The old lookup
    // compared them exactly, so the alias resolved to nothing at all.
    expect(resolveLineName("Gel", LINES)).toBe("GEL Line");
    expect(resolveLineName("gel line", LINES)).toBe("GEL Line");
    expect(resolveLineName("GEL LINE", LINES)).toBe("GEL Line");
  });

  it("does not swallow the capsule machines, which are their own lines", () => {
    expect(resolveLineName("Capsules Machine 1", LINES)).toBe("Capsules Machine 1");
    expect(resolveLineName("Capsules Machine 2", LINES)).toBe("Capsules Machine 2");
  });

  it("still reads the numbered lines however they are written", () => {
    expect(resolveLineName("Line 1", LINES)).toBe("Line 1");
    expect(resolveLineName("LINE 03", LINES)).toBe("Line 3");
    expect(resolveLineName("L6", LINES)).toBe("Line 6");
    expect(resolveLineName("Filler Line 2", LINES)).toBe("Line 2");
  });

  it("returns null for a heading that names no line", () => {
    // Better nothing than a wrong line: the row is reported unmatched rather than
    // silently added to whichever line sorted first.
    expect(resolveLineName("", LINES)).toBeNull();
    expect(resolveLineName("Total", LINES)).toBeNull();
    expect(resolveLineName("Notes", LINES)).toBeNull();
  });

  it("never invents a line that is not in the list", () => {
    const shortList = ["Line 1", "Line 2"];
    // With Tablet Line absent, the alias must not conjure it.
    expect(resolveLineName("Tablet", shortList)).toBeNull();
  });
});
