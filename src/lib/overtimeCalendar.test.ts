import { describe, it, expect } from "vitest";
import {
  calendarStatus, monthGrid, weekDays, viewRange, stepAnchor, viewTitle, duplicateOf, mondayOf,
} from "./overtimeCalendar";

const ask = (over: Partial<Parameters<typeof calendarStatus>[0]> = {}) => ({
  on_date: "2026-10-20", starts_at: "18:00:00", ends_at: "06:00:00", status: "open" as const, headcount: 2, ...over,
});
const yes = (decision: "accepted" | "reserve" | "declined" | null) => ({ answer: "yes" as const, decision });

describe("calendarStatus", () => {
  const before = new Date(2026, 9, 19, 12);
  it("reads an ask ahead by how full it is", () => {
    expect(calendarStatus(ask(), [], before)).toBe("needs");
    expect(calendarStatus(ask(), [yes("accepted"), yes(null)], before)).toBe("partial");
    expect(calendarStatus(ask(), [yes("accepted"), yes("accepted")], before)).toBe("full");
    // A reserve is not a place.
    expect(calendarStatus(ask(), [yes("reserve"), yes("reserve")], before)).toBe("needs");
  });
  it("a night ask runs past midnight, and is completed only when it ends the next morning", () => {
    expect(calendarStatus(ask(), [], new Date(2026, 9, 21, 3))).toBe("in_progress");
    expect(calendarStatus(ask(), [], new Date(2026, 9, 21, 6))).toBe("completed");
  });
  it("cancelled wins over the clock; closed is said only ahead of the day", () => {
    expect(calendarStatus(ask({ status: "cancelled" }), [], new Date(2027, 0, 1))).toBe("cancelled");
    expect(calendarStatus(ask({ status: "closed" }), [], before)).toBe("closed");
    expect(calendarStatus(ask({ status: "closed" }), [], new Date(2026, 9, 22))).toBe("completed");
  });
});

describe("the grid", () => {
  it("weeks start on Monday and cover the whole month", () => {
    const g = monthGrid("2026-10-18");
    expect(g[0][0].iso).toBe("2026-09-28");
    expect(g.flat().filter((d) => d.inMonth)).toHaveLength(31);
    expect(g[g.length - 1][6].iso).toBe("2026-11-01");
    expect(viewRange("month", "2026-10-18")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
  });
  it("a Sunday belongs to the week that began the Monday before", () => {
    expect(mondayOf("2026-10-18")).toBe("2026-10-12");
    expect(weekDays("2026-10-18")[6]).toBe("2026-10-18");
    expect(viewTitle("week", "2026-10-18")).toBe("12–18 Oct 2026");
  });
  it("stepping a month from the 31st lands on the last day, not two months on", () => {
    expect(stepAnchor("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(stepAnchor("week", "2026-12-28", 1)).toBe("2027-01-04");
    expect(stepAnchor("day", "2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("duplicateOf", () => {
  const existing = [
    { id: "a", on_date: "2026-10-20", starts_at: "06:00:00", ends_at: "18:00:00", department: "Packing", status: "open" as const },
    { id: "b", on_date: "2026-10-21", starts_at: "06:00:00", ends_at: "18:00:00", department: null, status: "cancelled" as const },
  ];
  it("same date, hours and department is a duplicate", () => {
    expect(duplicateOf({ on_date: "2026-10-20", starts_at: "06:00", ends_at: "18:00", department: "Packing" }, existing)).toBe("a");
    expect(duplicateOf({ on_date: "2026-10-20", starts_at: "06:00", ends_at: "18:00", department: null }, existing)).toBeNull();
  });
  it("a cancelled ask can be asked again", () => {
    expect(duplicateOf({ on_date: "2026-10-21", starts_at: "06:00", ends_at: "18:00", department: null }, existing)).toBeNull();
  });
});
