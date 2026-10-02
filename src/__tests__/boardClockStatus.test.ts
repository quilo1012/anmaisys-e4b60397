import { describe, expect, it } from "vitest";
import {
  boardClockLabel, boardClockTitle, boardClockVerdict, type BoardClockRow,
} from "@/lib/boardClockStatus";

const row = (p: Partial<BoardClockRow>): BoardClockRow => ({
  status: "clocked", clock_rows: 99, covered_people: 27, differs: 0, ...p,
});

describe("boardClockVerdict", () => {
  /**
   * The regression this file exists for.
   *
   * On the night board of 05/09/2026 `fn_board_clock_status` returns `clocked`: the
   * day had 99 clock rows and nothing disagreed. But `covered_people` is 0, because 2
   * of the 64 active night crew have ever appeared in TimeMoto. Nothing was compared.
   * Showing the agreement tone there tells a supervisor the night board was checked
   * and found right, which is the one thing that did not happen.
   */
  it("does not call it an agreement when nobody on the board is in the clock", () => {
    const v = boardClockVerdict(row({ status: "clocked", covered_people: 0, differs: 0 }));
    expect(v).toEqual({ kind: "no_basis" });
    expect(boardClockTitle(v!)).toMatch(/nothing here to compare/i);
  });

  it("calls it an agreement when there were people to compare", () => {
    expect(boardClockVerdict(row({ status: "clocked", covered_people: 27, differs: 0 })))
      .toEqual({ kind: "agrees", compared: 27 });
  });

  it("reports the disagreements, with what they were counted out of", () => {
    // The real Day board of 05/09.
    expect(boardClockVerdict(row({ status: "differs", covered_people: 27, differs: 7 })))
      .toEqual({ kind: "differs", differs: 7, compared: 27 });
  });

  /**
   * 30 of the board's 82 days have no clock at all. That is not a finding about
   * anybody, and it must never be dressed as one.
   */
  it("says a day with no clock rows is a plan, not a verdict", () => {
    const v = boardClockVerdict(row({ status: "planned", clock_rows: 0, covered_people: 56, differs: 0 }));
    expect(v).toEqual({ kind: "no_clock" });
    expect(boardClockLabel(v!)).toBe("Planned only");
  });

  /**
   * Read off clock_rows rather than off `status`. The function already returns
   * differs = 0 for a day with no clock — this stops the screen depending on that
   * promise, which is how the first version of the function shipped the day's
   * unconfirmed headcount as though it were a disagreement count.
   */
  it("trusts the row count over the word, when the two could disagree", () => {
    expect(boardClockVerdict(row({ status: "differs", clock_rows: 0, covered_people: 56, differs: 56 })))
      .toEqual({ kind: "no_clock" });
  });

  it("has nothing to say about a day it was given nothing for", () => {
    expect(boardClockVerdict(null)).toBeNull();
    expect(boardClockVerdict(undefined)).toBeNull();
  });

  it("counts one person in the singular, in the label and in the sentence", () => {
    expect(boardClockTitle({ kind: "agrees", compared: 1 })).toMatch(/All 1 person/);
    expect(boardClockTitle({ kind: "differs", differs: 1, compared: 1 })).toMatch(/1 of 1 comparable person/);
    expect(boardClockLabel({ kind: "differs", differs: 1, compared: 1 })).toBe("1 differ");
  });

  it("gives every verdict a label and a sentence", () => {
    for (const v of [
      { kind: "no_clock" }, { kind: "no_basis" },
      { kind: "agrees", compared: 3 }, { kind: "differs", differs: 1, compared: 3 },
    ] as const) {
      expect(boardClockLabel(v).length).toBeGreaterThan(0);
      expect(boardClockTitle(v).length).toBeGreaterThan(0);
    }
  });
});
