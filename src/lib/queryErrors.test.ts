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
