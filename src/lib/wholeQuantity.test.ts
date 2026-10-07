import { describe, it, expect } from "vitest";
import { parseWholeQuantity } from "./wholeQuantity";

/**
 * Measured against the live database on 2026-08-26, because the right answer here
 * depends on what a quantity in this plant actually looks like:
 *
 *   production_blender_entries    850 rows
 *   median                       1000
 *   p90                          4187
 *   max                         10921
 *   below 10                        1   (the minimum, 9)
 *
 * So `2.428` is 2428 typed with a thousands separator — the plant's leaders are
 * Brazilian and Portuguese, where 2.428 reads as two thousand four hundred and
 * twenty-eight. It is not two-point-four frascos: half a frasco does not exist and
 * a figure that small has occurred once in 850 entries.
 *
 * Which is exactly why this must NOT round. Math.round("2.428") is 2, and 2 would
 * be filed as a real shift's output with nothing on the screen to say the operator
 * meant a thousand times more. Today's behaviour — a raw Postgres 22P02 after a
 * round trip — is ugly, but it is loud. Quiet and wrong is the worse trade.
 */
describe("parseWholeQuantity", () => {
  it("takes a plain whole number", () => {
    expect(parseWholeQuantity("2428")).toEqual({ value: 2428, message: null });
  });

  it("takes a number with surrounding space, as a tablet keyboard leaves it", () => {
    expect(parseWholeQuantity(" 900 ")).toEqual({ value: 900, message: null });
  });

  it("refuses empty", () => {
    expect(parseWholeQuantity("").value).toBeNull();
  });

  it("refuses zero and negatives — the column is a shift's output", () => {
    expect(parseWholeQuantity("0").value).toBeNull();
    expect(parseWholeQuantity("-5").value).toBeNull();
  });

  it("refuses text", () => {
    expect(parseWholeQuantity("abc").value).toBeNull();
  });

  /**
   * The bug this file exists for. `quantity` is `integer`, so the row was refused
   * by Postgres with `invalid input syntax for type integer: "2.428"` — a message
   * written for a DBA, arriving after a network round trip, and filed as an
   * API_ERROR against an operator who did nothing unreasonable.
   */
  it("refuses a thousands separator instead of rounding it away", () => {
    const r = parseWholeQuantity("2.428");
    expect(r.value).toBeNull();
    // The number it would have silently become. Guards the whole point of the file.
    expect(r.value).not.toBe(2);
  });

  it("names the number the operator almost certainly meant", () => {
    expect(parseWholeQuantity("2.428").message).toContain("2428");
  });

  it("reads a longer separator run too", () => {
    expect(parseWholeQuantity("1.234.567").message).toContain("1234567");
  });

  /**
   * A comma is the other half of the same habit — 2,428 in English, and the tablet
   * keyboard offers both keys.
   */
  it("reads a comma separator the same way", () => {
    const r = parseWholeQuantity("2,428");
    expect(r.value).toBeNull();
    expect(r.message).toContain("2428");
  });

  /**
   * A genuine decimal is NOT a separator and must not be reported as one: telling
   * somebody who typed 2.5 that they meant 25 would be inventing a number, which is
   * the failure this whole file refuses to commit.
   */
  it("does not read a real decimal as a separator", () => {
    const r = parseWholeQuantity("2.5");
    expect(r.value).toBeNull();
    expect(r.message).not.toContain("25");
  });

  it("refuses a decimal that is not a separator pattern", () => {
    expect(parseWholeQuantity("2.4281").value).toBeNull();
  });

  /** Every refusal has to say something a person on a tablet can act on. */
  it("always carries a message when it refuses", () => {
    for (const bad of ["", "abc", "0", "-5", "2.5", "2.428", "2,428", "2.4281"]) {
      expect(parseWholeQuantity(bad).message, bad).toBeTruthy();
    }
  });
});
