import { describe, it, expect } from "vitest";
import { parseBlenderLabel, MAX_BLENDER_NUMBER } from "./blenderLabel";

/**
 * The bug this file exists for, measured against the live database on 2026-08-27.
 *
 * On 26/08 at 22:56 and again at 22:57 UTC the Line 4 operator was refused twice
 * with `new row for relation "production_blender_entries" violates check
 * constraint "production_blender_entries_blender_number_check"` — the raw Postgres
 * string, in a toast, on a tablet. Two minutes later the same operator saved
 * blender "33" on batch A26213, so whatever went into the box the second time was
 * not a blender at all. The batch field sits beside the blender field and
 * `"A26213".match(/\d+/)` is `26213`.
 *
 * The screen validated `Number.isFinite(n) && n >= 1` and stopped there. The
 * column's CHECK has always had an upper bound too, and nothing on the client knew
 * it, so every out-of-range value bought a network round trip and came back as a
 * constraint name.
 */
describe("parseBlenderLabel", () => {
  it("takes a plain blender", () => {
    expect(parseBlenderLabel("3")).toEqual({ label: "3", number: 3, message: null });
  });

  it("keeps a combined blender as typed and reports its first number", () => {
    // Two blenders feeding one run are written "7/8". The label is the identity;
    // the numeric column is for reporting, and takes the first of the pair.
    expect(parseBlenderLabel("7/8")).toEqual({ label: "7/8", number: 7, message: null });
  });

  it("trims what a tablet keyboard leaves behind", () => {
    expect(parseBlenderLabel(" 12 ")).toEqual({ label: "12", number: 12, message: null });
  });

  it("refuses empty and digitless text", () => {
    expect(parseBlenderLabel("").number).toBeNull();
    expect(parseBlenderLabel("   ").number).toBeNull();
    expect(parseBlenderLabel("blender").number).toBeNull();
  });

  it("refuses zero — the column starts at 1", () => {
    expect(parseBlenderLabel("0").number).toBeNull();
  });

  /**
   * The refusal that was missing. Everything below travelled to PostgREST before
   * this file existed.
   */
  it("refuses a number above the column's ceiling", () => {
    expect(parseBlenderLabel(String(MAX_BLENDER_NUMBER + 1)).number).toBeNull();
    expect(parseBlenderLabel("26213").number).toBeNull();
  });

  it("names the figure it read, the way the quantity parser names a separator run", () => {
    // Telling somebody "invalid" hides the mistake; telling them the app read
    // 26213 puts the batch code they typed back in front of them.
    expect(parseBlenderLabel("A26213").message).toContain("26213");
  });

  it("points at the batch field when the label carries letters", () => {
    // The observed failure. The batch box is next to this one.
    expect(parseBlenderLabel("A26213").message).toMatch(/batch/i);
  });

  it("does not blame the batch field for a plain mistyped number", () => {
    expect(parseBlenderLabel("4820").message).not.toMatch(/batch/i);
  });

  it("accepts the ceiling itself — B26188 reached blend 69 in five days", () => {
    expect(parseBlenderLabel(String(MAX_BLENDER_NUMBER)).number).toBe(MAX_BLENDER_NUMBER);
  });
});
