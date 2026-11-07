import { describe, it, expect } from "vitest";
import { addTallies, hasSmartTarget, smartCoverage, smartExportRows, smartOrigin, smartTally, smartVariancePct, type RagSmartMap } from "./ragSmartTarget";

// 06/11, day shift: Line 2 had its Smart Target kept at 07:39 and made 603.
// Saturday 07/11, 12:00 UTC: everything on 06/11 has run.
const NOW = Date.parse("2026-11-07T12:00:00Z");
const map: RagSmartMap = new Map([
  ["2026-11-06|Line 2|DAY", { expected: 3148, setAt: "2026-11-06T07:39:00Z", source: "page" }],
  ["2026-11-06|Line 4|DAY", { expected: 8067, setAt: "2026-11-06T05:30:00Z", source: "ahead" }],
]);

describe("the Smart Target on the RAG board", () => {
  it("compares a shift's actual with its Smart Target: Line 2 on 06/11 is -81%", () => {
    const t = smartTally(map, "2026-11-06", "Line 2", "DAY", 623, 603, NOW);
    expect(t).toEqual({ smart: 3148, comparedSmart: 3148, actual: 603, withNumber: 1, missing: 0 });
    expect(smartVariancePct(t)).toBe(-81);
    expect(smartCoverage(t)).toBeNull();
  });

  it("adds only the shifts with a number, and says which ran without one", () => {
    const total = addTallies([
      smartTally(map, "2026-11-06", "Line 2", "DAY", 623, 603, NOW),
      smartTally(map, "2026-11-06", "Line 2", "NIGHT", 3776, 3100, NOW),
      smartTally(map, "2026-11-06", "Line 4", "DAY", 7350, 7811, NOW),
      smartTally(map, "2026-11-06", "Line 4", "NIGHT", 0, 0, NOW),
    ]);
    expect(total).toEqual({ smart: 11215, comparedSmart: 11215, actual: 8414, withNumber: 2, missing: 1 });
    expect(smartVariancePct(total)).toBe(-25);
    expect(smartCoverage(total)).toBe("2 of 3 shifts that ran had a Smart Target");
  });

  it("has nothing to say for lines without a Smart Target, nor when the map is not readable", () => {
    expect(hasSmartTarget("Line 6")).toBe(true);
    expect(hasSmartTarget("Gel Packing")).toBe(false);
    expect(smartTally(map, "2026-11-06", "Gel Packing", "DAY", 1800, 1500)).toEqual({ smart: 0, comparedSmart: 0, actual: 0, withNumber: 0, missing: 0 });
    expect(smartTally(undefined, "2026-11-06", "Line 2", "DAY", 623, 603).withNumber).toBe(0);
    expect(smartVariancePct(smartTally(map, "2026-11-06", "Line 1", "DAY", 1550, 1432))).toBeNull();
  });

  it("shows a shift still to come and does not call it -100%, as 07/11 night read at noon", () => {
    const night: RagSmartMap = new Map([["2026-11-07|Line 2|NIGHT", { expected: 6666, setAt: "2026-11-07T17:30:00Z", source: "ahead" }]]);
    const before = smartTally(night, "2026-11-07", "Line 2", "NIGHT", 0, 0, NOW);
    expect(before).toEqual({ smart: 6666, comparedSmart: 0, actual: 0, withNumber: 1, missing: 0 });
    expect(smartVariancePct(before)).toBeNull();
    // Once it has started it counts, even before anything is logged.
    expect(smartVariancePct(smartTally(night, "2026-11-07", "Line 2", "NIGHT", 0, 0, Date.parse("2026-11-07T18:30:00Z")))).toBe(-100);
  });

  it("says when and how a Smart Target was made", () => {
    expect(smartOrigin(map.get("2026-11-06|Line 4|DAY")!)).toBe("Set 05:30, made before the shift from the iTouch queue.");
    expect(smartOrigin(map.get("2026-11-06|Line 2|DAY")!)).toBe("Set 07:39, saved from the Smart Target page.");
  });

  it("exports one row per shift that had a Smart Target or ran without one", () => {
    expect(smartExportRows(map, [
      { date: "2026-11-06", line: "Line 2", shift: "DAY", plan: 623, actual: 603 },
      { date: "2026-11-06", line: "Line 1", shift: "DAY", plan: 1550, actual: 1432 },
      { date: "2026-11-06", line: "Line 1", shift: "NIGHT", plan: 0, actual: 0 },
      { date: "2026-11-06", line: "Gel Packing", shift: "DAY", plan: 1800, actual: 1500 },
    ], NOW)).toEqual([
      { Date: "2026-11-06", Line: "Line 2", Shift: "Day", Plan: 623, "Smart Target": 3148, Actual: 603, "Smart variance %": -81, "Set at": "07:39" },
      { Date: "2026-11-06", Line: "Line 1", Shift: "Day", Plan: 1550, "Smart Target": null, Actual: 1432, "Smart variance %": null, "Set at": null },
    ]);
  });
});
