import { describe, it, expect } from "vitest";
import { blockOf, HEADCOUNT_BLOCKS } from "./headcountBlocks";

/**
 * Which block an area is drawn in, asserted rather than assumed.
 *
 * This file used to declare its own copy of `blockOf`, under a comment saying it
 * mirrored the one in ProductionHeadcountPage. The copy knew two blocks; the board
 * draws three. It passed either way, because the only function it ever called was
 * its own — so the real one could have regressed without a single test going red.
 * It now imports the thing it is testing.
 */
describe("blockOf", () => {
  it("puts the lines in production", () => {
    expect(blockOf({ section: "production", kind: "production" })).toBe("production");
  });

  it("keeps support areas in support", () => {
    expect(blockOf({ section: "support", kind: "support" })).toBe("support");
  });

  it("draws sectors in their own block", () => {
    // The case the copy could not express. The board has had a Sectors column all
    // along; the mirror in this file sent those areas to production or support by
    // their kind, and agreed with itself about it.
    expect(blockOf({ section: "sectors", kind: "production" })).toBe("sectors");
    expect(blockOf({ section: "sectors", kind: "support" })).toBe("sectors");
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
      { section: "sectors", kind: "support" },
    ];
    for (const c of cases) expect(HEADCOUNT_BLOCKS as readonly string[]).toContain(blockOf(c));
  });
});
