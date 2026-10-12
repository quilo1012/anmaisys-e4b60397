import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { boardShiftFor, withNoCrewOn } from "@/hooks/useHeadcount";

/**
 * Somebody active with no crew on file was on neither board.
 *
 * The roster puts each person on Day or Night by crew, and `boardShiftFor(null)` is
 * null, so they fell out of both — not in a column, not under "Not placed yet". The
 * sheet import creates people exactly like this. They now have their own column.
 */
const person = (id: string, shift_group: string | null) => ({ id, shift_group, shift_pattern_id: null });

describe("people with no crew on file", () => {
  it("are on neither board's roster, which is why they need a list of their own", () => {
    expect(boardShiftFor(null)).toBeNull();
    expect(boardShiftFor("")).toBeNull();
  });

  it("are found, and only they are", () => {
    const everyone = [person("a", "Day"), person("b", null), person("c", "Night"), person("d", "Weekend"), person("e", null)];
    expect(withNoCrewOn(everyone, [], "2026-10-12").map((p) => p.id)).toEqual(["b", "e"]);
  });

  it("are judged by the crew held on that date, not today's", () => {
    const history = [
      { employee_id: "b", shift_group: "Night", shift_pattern_id: null, effective_from: "2026-10-01", note: null },
    ];
    // Given a crew from 01/10: on the board from then, still crew-less before it.
    expect(withNoCrewOn([person("b", null)], history as never, "2026-10-12")).toEqual([]);
    expect(withNoCrewOn([person("b", null)], history as never, "2026-09-30").map((p) => p.id)).toEqual(["b"]);
  });
});
