import { describe, it, expect } from "vitest";
import { addTallies, hasSmartTarget, smartCoverage, smartExportRows, smartOrigin, smartStatus, smartTally, smartVariancePct, type RagSmartMap } from "./ragSmartTarget";
import type { ShiftOutcome } from "./shiftOutcome";

const RAN: ShiftOutcome = { kind: "ran", finishedAt: null, openMinutes: 720, grossMinutes: 720 };
const UPCOMING: ShiftOutcome = { kind: "upcoming" };
const NOT_RUN: ShiftOutcome = { kind: "not_run" };
// Line 2 on 07/11 last ran at 12:40: open 400 of 720 minutes.
const CLOSED_1240: ShiftOutcome = { kind: "ran", finishedAt: "2026-11-07T12:40:00.000Z", openMinutes: 400, grossMinutes: 720 };

const map: RagSmartMap = new Map([
  ["2026-11-06|Line 2|DAY", { expected: 3148, setAt: "2026-11-06T07:39:00Z", source: "page" }],
  ["2026-11-06|Line 4|DAY", { expected: 8067, setAt: "2026-11-06T05:30:00Z", source: "ahead" }],
  ["2026-11-07|Line 2|DAY", { expected: 2715, setAt: "2026-11-07T05:30:00Z", source: "ahead" }],
  ["2026-11-07|Line 2|NIGHT", { expected: 6666, setAt: "2026-11-07T17:30:00Z", source: "ahead" }],
]);

describe("the Smart Target on the RAG board", () => {
  it("compares a shift's actual with its Smart Target: Line 2 on 06/11 is -81%", () => {
    const t = smartTally(map, "2026-11-06", "Line 2", "DAY", 623, 603, RAN);
    expect(t).toMatchObject({ smart: 3148, comparedSmart: 3148, actual: 603, withNumber: 1, missing: 0, cut: null });
    expect(smartVariancePct(t)).toBe(-81);
    expect(smartCoverage(t)).toBeNull();
    expect(smartStatus(t)).toBeNull();
  });

  it("adds only the shifts with a number, and says which ran without one", () => {
    const total = addTallies([
      smartTally(map, "2026-11-06", "Line 2", "DAY", 623, 603, RAN),
      smartTally(map, "2026-11-06", "Line 2", "NIGHT", 3776, 3100, RAN),
      smartTally(map, "2026-11-06", "Line 4", "DAY", 7350, 7811, RAN),
      smartTally(map, "2026-11-06", "Line 4", "NIGHT", 0, 0, NOT_RUN),
    ]);
    expect(total).toMatchObject({ smart: 11215, comparedSmart: 11215, actual: 8414, withNumber: 2, missing: 1 });
    expect(smartVariancePct(total)).toBe(-25);
    expect(smartCoverage(total)).toBe("2 of 3 shifts that ran had a Smart Target");
  });

  it("shows a shift still to come and does not call it -100%", () => {
    const t = smartTally(map, "2026-11-07", "Line 2", "NIGHT", 0, 0, UPCOMING);
    expect(t).toMatchObject({ smart: 6666, comparedSmart: 0, withNumber: 1 });
    expect(smartVariancePct(t)).toBeNull();
  });

  it("keeps 07/11 night out of everything once it did not run, and says so (Q77)", () => {
    const night = smartTally(map, "2026-11-07", "Line 2", "NIGHT", 0, 0, NOT_RUN);
    expect(night).toMatchObject({ smart: 0, comparedSmart: 0, withNumber: 0, notRun: 1, notRunSmart: 6666 });
    expect(smartStatus(night)).toBe("Not run");
    const day = smartTally(map, "2026-11-07", "Line 2", "DAY", 100, 86, CLOSED_1240);
    const total = addTallies([day, night]);
    expect(total).toMatchObject({ smart: 2715, comparedSmart: 1508, withNumber: 1, missing: 0 });
  });

  it("compares a line that closed at 12:40 with the target for its hours open (Q78)", () => {
    const t = smartTally(map, "2026-11-07", "Line 2", "DAY", 100, 86, CLOSED_1240);
    expect(t).toMatchObject({ smart: 2715, comparedSmart: 1508, cut: { at: "2026-11-07T12:40:00.000Z", target: 1508 } });
    expect(smartVariancePct(t)).toBe(-94);
    expect(smartStatus(t)).toBe("Finished 12:40");
  });

  it("has nothing to say for lines without a Smart Target, nor when the map is not readable", () => {
    expect(hasSmartTarget("Line 6")).toBe(true);
    expect(hasSmartTarget("Gel Packing")).toBe(false);
    expect(smartTally(map, "2026-11-06", "Gel Packing", "DAY", 1800, 1500, RAN).withNumber).toBe(0);
    expect(smartTally(undefined, "2026-11-06", "Line 2", "DAY", 623, 603, RAN).withNumber).toBe(0);
    expect(smartVariancePct(smartTally(map, "2026-11-06", "Line 1", "DAY", 1550, 1432, RAN))).toBeNull();
  });

  it("says when and how a Smart Target was made", () => {
    expect(smartOrigin(map.get("2026-11-06|Line 4|DAY")!)).toBe("Set 05:30, made before the shift from the iTouch queue.");
    expect(smartOrigin(map.get("2026-11-06|Line 2|DAY")!)).toBe("Set 07:39, saved from the Smart Target page.");
  });

  it("exports one row per shift with a Smart Target, that ran without one, or that did not run", () => {
    const outcomeOf = (date: string, _line: string, shift: string) =>
      date === "2026-11-07" ? (shift === "DAY" ? CLOSED_1240 : NOT_RUN) : RAN;
    expect(smartExportRows(map, [
      { date: "2026-11-06", line: "Line 2", shift: "DAY", plan: 623, actual: 603 },
      { date: "2026-11-06", line: "Line 1", shift: "DAY", plan: 1550, actual: 1432 },
      { date: "2026-11-06", line: "Line 1", shift: "NIGHT", plan: 0, actual: 0 },
      { date: "2026-11-07", line: "Line 2", shift: "DAY", plan: 100, actual: 86 },
      { date: "2026-11-07", line: "Line 2", shift: "NIGHT", plan: 0, actual: 0 },
    ], outcomeOf)).toEqual([
      { Date: "2026-11-06", Line: "Line 2", Shift: "Day", Plan: 623, "Smart Target": 3148, Status: null, "Target for hours open": null, Actual: 603, "Smart variance %": -81, "Set at": "07:39" },
      { Date: "2026-11-06", Line: "Line 1", Shift: "Day", Plan: 1550, "Smart Target": null, Status: null, "Target for hours open": null, Actual: 1432, "Smart variance %": null, "Set at": null },
      { Date: "2026-11-07", Line: "Line 2", Shift: "Day", Plan: 100, "Smart Target": 2715, Status: "Finished 12:40", "Target for hours open": 1508, Actual: 86, "Smart variance %": -94, "Set at": "05:30" },
      { Date: "2026-11-07", Line: "Line 2", Shift: "Night", Plan: null, "Smart Target": 6666, Status: "Not run", "Target for hours open": null, Actual: null, "Smart variance %": null, "Set at": "17:30" },
    ]);
  });
});
