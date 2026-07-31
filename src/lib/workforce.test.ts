import { describe, it, expect } from "vitest";
import { describeDays, worksOn } from "@/hooks/useWorkforce";

describe("shift patterns", () => {
  it("reads a Monday-to-Thursday run in order", () => {
    expect(describeDays([1, 2, 3, 4])).toBe("Mon, Tue, Wed, Thu");
  });

  it("reads a pattern that wraps the weekend starting on Friday", () => {
    // 5,6,7,1 sorted numerically would read "Mon, Fri, Sat, Sun", which is not the
    // run anyone works.
    expect(describeDays([5, 6, 7, 1])).toBe("Fri, Sat, Sun, Mon");
  });

  it("says nothing rather than guessing when no pattern is set", () => {
    expect(describeDays([])).toBe("—");
    expect(describeDays(null)).toBe("—");
  });

  it("knows whether someone is in on a given day", () => {
    const friToMon = [5, 6, 7, 1];
    expect(worksOn(friToMon, new Date("2026-07-31T09:00:00"))).toBe(true);  // Friday
    expect(worksOn(friToMon, new Date("2026-08-02T09:00:00"))).toBe(true);  // Sunday
    expect(worksOn(friToMon, new Date("2026-08-03T09:00:00"))).toBe(true);  // Monday
    expect(worksOn(friToMon, new Date("2026-07-29T09:00:00"))).toBe(false); // Wednesday
  });

  it("treats Sunday as 7, not as JavaScript's 0", () => {
    expect(worksOn([7], new Date("2026-08-02T09:00:00"))).toBe(true);
    expect(worksOn([1], new Date("2026-08-02T09:00:00"))).toBe(false);
  });
});

describe("who the board shows on a given day", () => {
  // The rule the board runs on: a pattern that covers the day means "due in".
  // Someone with no pattern is not "off" — they are unrecorded, and must still
  // appear, or the headcount quietly shrinks.
  const monThu = [1, 2, 3, 4];
  const friMon = [5, 6, 7, 1];
  const saturday = new Date("2026-08-01T12:00:00");
  const tuesday = new Date("2026-08-04T12:00:00");

  it("puts the weekend pattern in on Saturday and the weekday one out", () => {
    expect(worksOn(friMon, saturday)).toBe(true);
    expect(worksOn(monThu, saturday)).toBe(false);
  });

  it("swaps them round on a Tuesday", () => {
    expect(worksOn(monThu, tuesday)).toBe(true);
    expect(worksOn(friMon, tuesday)).toBe(false);
  });

  it("counts Monday as worked by both patterns that include it", () => {
    const monday = new Date("2026-08-03T12:00:00");
    expect(worksOn(monThu, monday)).toBe(true);
    expect(worksOn(friMon, monday)).toBe(true);
  });
});
