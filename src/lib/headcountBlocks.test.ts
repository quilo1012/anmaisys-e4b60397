import { describe, it, expect } from "vitest";

/**
 * Which block an area is drawn in, asserted rather than assumed.
 *
 * Mirrors `blockOf` in ProductionHeadcountPage. The rule it protects: an area is
 * never invisible. The board used to filter on `section` against a fixed list of
 * four names, so an area whose section was renamed, misspelt or left blank dropped
 * off the board while its allocations went on being saved — people rostered onto a
 * column nobody could see.
 */
const blockOf = (a: { section: string | null; kind: string }): string => {
  const s = (a.section ?? "").toLowerCase();
  if (s === "production" || s === "support") return s;
  return a.kind === "production" ? "production" : "support";
};

describe("blockOf", () => {
  it("puts the lines in production", () => {
    expect(blockOf({ section: "production", kind: "production" })).toBe("production");
  });

  it("keeps support areas in support", () => {
    expect(blockOf({ section: "support", kind: "support" })).toBe("support");
  });

  it("draws Hygiene, Quality and Runner with production even though they count as support", () => {
    // The factory's sheet puts them there: the people planning the day read them
    // alongside the lines they serve. `kind` is untouched, so the totals do not move.
    for (const name of ["Hygiene", "Quality", "Runner"]) {
      expect(blockOf({ section: "production", kind: "support" }), name).toBe("production");
    }
  });

  it("never loses an area whose section is unrecognised", () => {
    expect(blockOf({ section: "main_lines", kind: "production" })).toBe("production");
    expect(blockOf({ section: "warehouse_quality", kind: "support" })).toBe("support");
    expect(blockOf({ section: "", kind: "production" })).toBe("production");
    expect(blockOf({ section: null, kind: "support" })).toBe("support");
    expect(blockOf({ section: "  PRODUCTION  ".trim().toLowerCase(), kind: "support" })).toBe("production");
  });

  it("only ever answers with a block the board draws", () => {
    const cases = [
      { section: "anything", kind: "production" },
      { section: null, kind: "whatever" },
      { section: "SUPPORT", kind: "production" },
    ];
    for (const c of cases) expect(["production", "support"]).toContain(blockOf(c));
  });
});
