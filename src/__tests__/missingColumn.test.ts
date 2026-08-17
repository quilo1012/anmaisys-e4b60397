import { describe, expect, it } from "vitest";
import { isMissingColumn } from "@/lib/postgrestErrors";

/**
 * The regression this exists for.
 *
 * On 17/08 a quality manager typing a price into a label got
 * "Could not find the 'points' column of 'quality_options' in the schema cache"
 * — a PostgREST internal, with nothing in it about what to do next. The screen HAD
 * a proper message for exactly this case; it was gated on `42703`, which is what
 * Postgres returns when a SELECT names a column that does not exist. A write never
 * reaches Postgres: PostgREST checks its own schema cache first and answers
 * `PGRST204`. So the safety net existed and did not catch the case it was built for.
 */

describe("isMissingColumn", () => {
  it("catches the Postgres code, which a read gets", () => {
    expect(isMissingColumn({ code: "42703", message: 'column "points" does not exist' })).toBe(true);
  });

  it("catches the PostgREST code, which a write gets", () => {
    expect(isMissingColumn({
      code: "PGRST204",
      message: "Could not find the 'points' column of 'quality_options' in the schema cache",
    })).toBe(true);
  });

  it("leaves every other failure alone, so a real error is not swallowed", () => {
    // A permission failure must keep its own message. Reporting "the migration has
    // not run" to somebody whose RLS policy refused them sends them to the wrong place.
    expect(isMissingColumn({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingColumn({ code: "23514", message: "check constraint violated" })).toBe(false);
  });

  it("survives an error with no code at all", () => {
    expect(isMissingColumn({ message: "network error" })).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
    expect(isMissingColumn(undefined)).toBe(false);
  });
});
