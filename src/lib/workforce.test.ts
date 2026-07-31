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
