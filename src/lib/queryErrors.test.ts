import { describe, it, expect, vi, beforeEach } from "vitest";
import { describeError, reportQueryError, resetErrorDedupe } from "./queryErrors";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("describeError", () => {
  it("says plainly that access was refused, for every shape the refusal arrives in", () => {
    for (const err of [
      { status: 403 },
      { statusCode: 401 },
      { code: "42501" },
      { message: "new row violates row-level security policy for table \"work_orders\"" },
    ]) {
      expect(describeError(err)?.title).toBe("You do not have access to this");
    }
  });

  it("stays quiet for a rule the user has already been told about", () => {
    // P0001 is a RAISE EXCEPTION from one of our own triggers — "Attach the evidence
    // before validating this action" — and the dialog that made the request says so.
    expect(describeError({ code: "P0001", message: "Attach the evidence before validating this action." })).toBeNull();
  });

  it("stays quiet for .single() finding no rows", () => {
    expect(describeError({ code: "PGRST116" })).toBeNull();
  });

  it("names a lost connection as a connection problem, not a data problem", () => {
    expect(describeError({ message: "Failed to fetch" })?.title).toBe("No connection to the server");
  });

  it("falls back to the server's own words rather than a shrug", () => {
    const d = describeError({ message: "duplicate key value violates unique constraint" });
    expect(d?.title).toBe("Something did not load");
    expect(d?.description).toContain("duplicate key");
  });
});

describe("reportQueryError", () => {
  beforeEach(() => resetErrorDedupe());

  it("reports once and then holds its tongue for the same failure", () => {
    // One broken screen can fire six queries; nobody needs six identical toasts.
    expect(reportQueryError({ status: 403 }, 1_000)).toBe(true);
    expect(reportQueryError({ status: 403 }, 3_000)).toBe(false);
    expect(reportQueryError({ status: 403 }, 12_000)).toBe(true);
  });

  it("does not report what describeError chose to ignore", () => {
    expect(reportQueryError({ code: "P0001" }, 1_000)).toBe(false);
  });
});

describe("a query that answers the missing-schema question itself", () => {
  beforeEach(() => resetErrorDedupe());

  /**
   * `useScoringFreeze` and `useLabelAttribution` ask "has this migration landed here",
   * and a missing table IS their answer — `isMissingTable` turns it into `missing:
   * true` and the screen adjusts its wording. They still have to throw, because that
   * is the only way React Query hands them `query.error` to read.
   *
   * On 19/08/2026 production had the frontend of 20260822090000 and not its SQL, and
   * every screen carrying the hook toasted "Something did not load — Could not find
   * the table 'public.scoring_version' in the schema cache" over a screen that had
   * already handled it. The mutation side of the same cache has always known this
   * rule: a mutation with its own onError is left to speak for itself.
   */
  it("is left to speak for itself when the table is simply not there yet", () => {
    const err = { code: "PGRST205", message: "Could not find the table 'public.scoring_version' in the schema cache" };
    expect(reportQueryError(err, 1_000, { schemaOptional: true })).toBe(false);
  });

  it("is left to speak for itself for a column that has not arrived either", () => {
    expect(reportQueryError({ code: "42703" }, 1_000, { schemaOptional: true })).toBe(false);
  });

  /**
   * Narrow on purpose. The flag says "this query knows what an absent table means",
   * never "this query is allowed to fail in silence" — a policy refusing it is still
   * the thing the person needs to be told, and staying quiet would send them looking
   * for an unapplied migration that has nothing to do with it.
   */
  it("still says so when the same query is refused rather than unmigrated", () => {
    expect(reportQueryError({ status: 403 }, 1_000, { schemaOptional: true })).toBe(true);
  });

  it("says so for a missing table on any query that has not claimed to handle it", () => {
    expect(reportQueryError({ code: "PGRST205" }, 1_000)).toBe(true);
  });
});
