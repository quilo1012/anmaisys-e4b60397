import { describe, it, expect } from "vitest";
import { formatDuration, formatDurationCompact } from "./formatDuration";

/**
 * There were two functions called `formatDuration`, both taking seconds, in
 * src/lib/formatDuration.ts (15 importers) and in useDailyIssueSummary.ts (1). They
 * disagreed: 2700 seconds was "0h 45m" in one and "45m" in the other, and 3660 was
 * "1h 1m" against "1h 01m". The same stop read differently depending on which screen
 * you were on, and nothing connected the two files for anyone to notice.
 *
 * Both renderings are kept, because both are wanted — the padded compact one goes
 * into a text block that gets pasted into a weekly report. What is gone is the second
 * definition, and the ambiguity about which one a caller gets.
 */
describe("formatDuration", () => {
  it("always names the hours, even when there are none", () => {
    expect(formatDuration(2700)).toBe("0h 45m");
    expect(formatDuration(3660)).toBe("1h 1m");
  });

  it("shows a dash rather than a number it does not have", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(NaN)).toBe("—");
  });
});

describe("formatDurationCompact", () => {
  it("drops the hours when there are none", () => {
    expect(formatDurationCompact(2700)).toBe("45m");
    expect(formatDurationCompact(0)).toBe("0m");
  });

  it("pads the minutes once there is an hour to read them against", () => {
    expect(formatDurationCompact(3660)).toBe("1h 01m");
    expect(formatDurationCompact(7200)).toBe("2h 00m");
  });

  it("shows a dash rather than a number it does not have", () => {
    expect(formatDurationCompact(null)).toBe("—");
    expect(formatDurationCompact(undefined)).toBe("—");
    expect(formatDurationCompact(-1)).toBe("—");
  });

  it("shows a dash for NaN instead of printing it", () => {
    // The copy in useDailyIssueSummary rendered this as "NaNh NaNm": NaN < 60 is
    // false, so it fell through to the hours branch and printed the word.
    expect(formatDurationCompact(NaN)).toBe("—");
  });

  it("agrees with the long form about how many minutes there are", () => {
    for (const sec of [0, 59, 60, 2700, 3660, 7200, 86_399]) {
      const mins = (s: string) => s.match(/(\d+)m$/)![1].replace(/^0/, "") || "0";
      expect(mins(formatDurationCompact(sec)), String(sec)).toBe(mins(formatDuration(sec)));
    }
  });
});
