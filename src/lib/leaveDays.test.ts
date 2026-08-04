import { describe, it, expect } from "vitest";
import { leaveDays, eachDate, describeLeaveDays } from "@/lib/leaveDays";

// ISO weekdays: 1 = Monday … 7 = Sunday.
const MON_THU = [1, 2, 3, 4];
const MON_FRI = [1, 2, 3, 4, 5];
const FRI_MON = [5, 6, 7, 1];

describe("eachDate", () => {
  it("is inclusive at both ends", () => {
    expect(eachDate("2026-08-03", "2026-08-05")).toEqual(["2026-08-03", "2026-08-04", "2026-08-05"]);
  });

  it("treats a backwards range as empty rather than crashing", () => {
    expect(eachDate("2026-08-05", "2026-08-03")).toEqual([]);
  });

  it("steps over a month end", () => {
    expect(eachDate("2026-07-31", "2026-08-01")).toEqual(["2026-07-31", "2026-08-01"]);
  });
});

describe("leaveDays", () => {
  it("counts a week off for a Mon–Thu person as four days, not seven", () => {
    // Mon 03 Aug 2026 to Sun 09 Aug 2026.
    const d = leaveDays("2026-08-03", "2026-08-09", MON_THU);
    expect(d.calendarDays).toBe(7);
    expect(d.workingDays).toBe(4);
    expect(d.workingDates).toEqual(["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"]);
  });

  it("counts the same week as five for a Mon–Fri person", () => {
    expect(leaveDays("2026-08-03", "2026-08-09", MON_FRI).workingDays).toBe(5);
  });

  it("handles a pattern that wraps the weekend", () => {
    // Fri–Mon: Friday, Saturday, Sunday and Monday.
    const d = leaveDays("2026-08-03", "2026-08-09", FRI_MON);
    expect(d.workingDays).toBe(4);
    expect(d.workingDates).toEqual(["2026-08-03", "2026-08-07", "2026-08-08", "2026-08-09"]);
  });

  it("says nothing rather than zero when no rota is on file", () => {
    // Missing information and "works no days" are different facts. A zero would let
    // a request be approved for nothing with nobody knowing which it was.
    const d = leaveDays("2026-08-03", "2026-08-09", null);
    expect(d.workingDays).toBeNull();
    expect(d.calendarDays).toBe(7);
    expect(describeLeaveDays(d)).toBe("rota not recorded");
  });

  it("reports zero working days when the range genuinely misses the rota", () => {
    // A Mon–Thu person asking for the Saturday and Sunday spends no entitlement.
    const d = leaveDays("2026-08-08", "2026-08-09", MON_THU);
    expect(d.workingDays).toBe(0);
    expect(describeLeaveDays(d)).toBe("no working days in this range");
  });

  it("counts a single day correctly", () => {
    expect(describeLeaveDays(leaveDays("2026-08-04", "2026-08-04", MON_THU))).toBe("1 day");
  });

  it("does not drift across a daylight-saving boundary", () => {
    // UK clocks go back on 25 Oct 2026. Naive date maths repeats or skips a day here.
    const d = leaveDays("2026-10-23", "2026-10-27", MON_FRI);
    expect(d.calendarDays).toBe(5);
    expect(d.workingDates).toEqual(["2026-10-23", "2026-10-26", "2026-10-27"]);
  });
});
