import { describe, expect, it } from "vitest";
import { isMissingTable } from "@/lib/postgrestErrors";

/**
 * Why "the table is not there" needs its own reading, separate from the column one.
 *
 * `quality_label_attribution` decides which labels are NOT the shift leader's —
 * Maintenance and GMP ship excluded. It arrives in a migration, and a migration in
 * this repo is not proof that production has it. When the read fails, `excluded` is
 * an empty set, and an empty set is a VALID answer meaning "nothing is excluded": a
 * machine failure silently goes back to costing the leader points, with nothing on
 * screen saying so. That is the 5-points-instead-of-2 case.
 *
 * So the manager screen has to be able to tell "the rule is off" from "the rule is
 * on and nothing is excluded", and only the error code can tell it apart.
 */
describe("isMissingTable", () => {
  it("catches the Postgres code, which a read gets", () => {
    expect(isMissingTable({ code: "42P01", message: 'relation "quality_label_attribution" does not exist' })).toBe(true);
  });

  it("catches the PostgREST code, which a write gets", () => {
    expect(isMissingTable({
      code: "PGRST205",
      message: "Could not find the table 'public.quality_label_attribution' in the schema cache",
    })).toBe(true);
  });

  it("does not confuse a missing column for a missing table", () => {
    // Different fix, different message. A missing column means one feature is off;
    // a missing table means the whole attribution rule is.
    expect(isMissingTable({ code: "42703", message: 'column "points" does not exist' })).toBe(false);
    expect(isMissingTable({ code: "PGRST204", message: "Could not find the 'points' column" })).toBe(false);
  });

  it("leaves every other failure alone, so a real error is not swallowed", () => {
    expect(isMissingTable({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTable({ message: "network error" })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
    expect(isMissingTable(undefined)).toBe(false);
  });
});
