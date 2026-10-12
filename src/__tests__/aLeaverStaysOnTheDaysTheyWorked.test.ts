import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { boardPeopleOn } from "@/hooks/useHeadcount";

/**
 * A leaver stays on the board of every day they worked, and on no day after.
 *
 * The board drew active people only. On 12/10 that hid 238 saved allocations since
 * August: Ramon Oliveira and five others gone from the 01/09 Night lines they worked,
 * and Vitor Dantas gone from the Day board of 02–11/10 because his bookings sat on a
 * duplicate record somebody had deactivated.
 */
const active = new Map([
  ["a", { id: "a", full_name: "Vitor Dantas", left_on: undefined as string | null | undefined }],
]);
const ramon = { id: "r", full_name: "Ramon Oliveira", left_on: "2026-10-12" };
const noDate = { id: "n", full_name: "Nobody Said When", left_on: null };

describe("who the board can draw on a date", () => {
  it("includes a leaver on a day before they left", () => {
    expect(boardPeopleOn(active, [ramon], "2026-09-01").has("r")).toBe(true);
  });

  it("includes them on their last day", () => {
    expect(boardPeopleOn(active, [ramon], "2026-10-12").has("r")).toBe(true);
  });

  it("leaves them off every day after", () => {
    expect(boardPeopleOn(active, [ramon], "2026-10-13").has("r")).toBe(false);
  });

  it("leaves off a leaver nobody gave a leaving date, on any day", () => {
    expect(boardPeopleOn(active, [noDate], "2026-01-01").has("n")).toBe(false);
  });

  it("keeps every active person, and does not mark them as gone", () => {
    const out = boardPeopleOn(active, [ramon], "2026-09-01");
    expect(out.get("a")?.left_on).toBeFalsy();
    expect(out.get("r")?.left_on).toBe("2026-10-12");
  });

  it("does not change the map the pickers read", () => {
    boardPeopleOn(active, [ramon], "2026-09-01");
    expect([...active.keys()]).toEqual(["a"]);
  });
});
