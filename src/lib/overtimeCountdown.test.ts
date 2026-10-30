import { describe, it, expect } from "vitest";
import { nextBookedShift, countdownLabel, dayWord, shiftDates, type BookedShift } from "./overtimeCountdown";

const b = (key: string, date: string, startsAt: string, endsAt: string, extra: Partial<BookedShift> = {}): BookedShift =>
  ({ key, date, startsAt, endsAt, shift: Number(startsAt.slice(0, 2)) >= 18 || Number(startsAt.slice(0, 2)) < 6 ? "Night" : "Day", source: "ask", ...extra });

// Friday 30/10/2026, 22:20 — when the reminder was asked for.
const NOW = new Date("2026-10-30T22:20:00");

describe("the next booked overtime", () => {
  it("is the earliest still to start, with how many more come after", () => {
    const { next, more } = nextBookedShift([
      b("mon", "2026-11-02", "06:00:00", "18:00:00"),
      b("sat", "2026-10-31", "06:00:00", "18:00:00", { area: "Line 2", source: "headcount" }),
      b("tue", "2026-11-03", "06:00:00", "14:00:00"),
    ], NOW);
    expect(next?.key).toBe("sat");
    expect(next?.area).toBe("Line 2");
    expect(next?.onNow).toBe(false);
    expect(more).toBe(2);
  });

  it("is the one on now while it runs, and gone once it has ended", () => {
    const sat = b("sat", "2026-10-31", "06:00:00", "18:00:00");
    expect(nextBookedShift([sat], new Date("2026-10-31T09:00:00")).next?.onNow).toBe(true);
    expect(nextBookedShift([sat], new Date("2026-10-31T18:00:00")).next).toBeNull();
  });

  it("keeps a night shift until the morning it ends", () => {
    const night = b("fri-night", "2026-10-30", "18:00:00", "06:00:00");
    const { end } = shiftDates(night);
    expect(end).toEqual(new Date("2026-10-31T06:00:00"));
    expect(nextBookedShift([night], new Date("2026-10-31T02:00:00")).next?.onNow).toBe(true);
  });

  it("counts two bookings for the same start once", () => {
    const { more } = nextBookedShift([
      b("a", "2026-10-31", "06:00:00", "14:00:00"),
      b("b", "2026-10-31", "06:00:00", "18:00:00", { source: "headcount" }),
    ], NOW);
    expect(more).toBe(0);
  });

  it("is nothing when nothing is booked", () => {
    expect(nextBookedShift([], NOW)).toEqual({ next: null, more: 0 });
  });
});

describe("the time left, in words", () => {
  it.each([
    [7 * 3600_000 + 40 * 60_000, "7 h 40 min"],
    [2 * 86_400_000 + 5 * 3600_000, "2 d 5 h"],
    [86_400_000, "1 d"],
    [3 * 3600_000, "3 h"],
    [42 * 60_000 + 30_000, "42 min"],
    [30_000, "less than a minute"],
  ])("%d ms is %s", (ms, label) => {
    expect(countdownLabel(ms)).toBe(label);
  });

  it("says today, tomorrow, or the date", () => {
    expect(dayWord("2026-10-30", NOW)).toBe("today");
    expect(dayWord("2026-10-31", NOW)).toBe("tomorrow");
    expect(dayWord("2026-11-02", NOW)).toMatch(/Monday/);
  });
});
