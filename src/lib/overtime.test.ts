import { describe, it, expect } from "vitest";
import {
  calculatePeriodOvertime,
  hoursOnSite,
  weeklyTargetForPattern,
  workedHoursForDay,
  DEFAULT_RULES,
  type WorkedDay,
} from "./overtime";

const day = (date: string, totalHours: number, scheduled: boolean): WorkedDay => ({
  date,
  totalHours,
  scheduled,
});

/** Five days of a given length, Mon–Fri of the week beginning `monday`. */
function week(monday: string, hoursPerDay: number, scheduled = true): WorkedDay[] {
  const start = Date.parse(`${monday}T00:00:00Z`);
  return Array.from({ length: 5 }, (_, i) =>
    day(new Date(start + i * 86_400_000).toISOString().slice(0, 10), hoursPerDay, scheduled),
  );
}

describe("hoursOnSite — a night shift crosses midnight", () => {
  it("measures a day shift", () => {
    expect(hoursOnSite("06:00", "18:00")).toBe(12);
  });

  it("measures nights as twelve hours, not minus twelve", () => {
    expect(hoursOnSite("18:00", "06:00")).toBe(12);
  });

  it("handles half hours", () => {
    expect(hoursOnSite("08:30", "17:00")).toBe(8.5);
  });

  it("treats an identical start and end as a full day, not zero", () => {
    expect(hoursOnSite("06:00", "06:00")).toBe(24);
  });

  it("rejects something that is not a time", () => {
    expect(() => hoursOnSite("morning", "18:00")).toThrow(/Not a time/);
  });
});

describe("weeklyTargetForPattern — the week comes from the rota, not from 44", () => {
  const P = (days: number[], s: string, e: string) => ({ days, starts_at: s, ends_at: e });

  it("derives exactly 44 from every twelve-hour rota", () => {
    // 4 × (12 − 1). The contractual week falls out of the times and the break,
    // which is the strongest evidence the break rule is right.
    expect(weeklyTargetForPattern(P([1, 2, 3, 4], "06:00", "18:00"))).toBe(44);
    expect(weeklyTargetForPattern(P([2, 3, 4, 5], "06:00", "18:00"))).toBe(44);
    expect(weeklyTargetForPattern(P([5, 6, 7, 1], "06:00", "18:00"))).toBe(44);
    expect(weeklyTargetForPattern(P([1, 2, 3, 4], "18:00", "06:00"))).toBe(44);
  });

  it("keeps the shorter contracts short instead of calling them a deficit", () => {
    expect(weeklyTargetForPattern(P([1, 2, 3, 4, 5], "09:00", "15:00"))).toBe(25);
    expect(weeklyTargetForPattern(P([1, 2, 3, 4, 5], "09:00", "17:00"))).toBe(35);
    expect(weeklyTargetForPattern(P([1, 2, 3, 4, 5], "08:00", "17:00"))).toBe(40);
    expect(weeklyTargetForPattern(P([7], "08:00", "16:00"))).toBe(7);
  });

  it("returns null when the rota has no hours recorded", () => {
    // Null, not 44: not knowing somebody's contract is different from knowing it is
    // the standard one, and a default here would invent a deficit.
    expect(weeklyTargetForPattern({ days: [1, 2, 3, 4], starts_at: null, ends_at: null })).toBeNull();
    expect(weeklyTargetForPattern(P([], "06:00", "18:00"))).toBeNull();
  });
});

describe("workedHoursForDay — the break comes off a scheduled day only", () => {
  it("takes an hour off a scheduled day", () => {
    expect(workedHoursForDay(day("2026-06-08", 9, true))).toBe(8);
  });

  it("leaves an overtime day whole", () => {
    // Nobody takes an unpaid lunch on a shift they came in specially for.
    expect(workedHoursForDay(day("2026-06-13", 9, false))).toBe(9);
  });

  it("does not push a short scheduled day below zero", () => {
    // Forty minutes on a scheduled day is no hours worked, not minus twenty. A
    // negative here would be silently repaid out of somebody's overtime later.
    expect(workedHoursForDay(day("2026-06-08", 0.67, true))).toBe(0);
  });

  it("honours rules other than the default", () => {
    expect(workedHoursForDay(day("2026-06-08", 12, true), { weeklyTargetHours: 40, breakHours: 0.5 }))
      .toBe(11.5);
  });
});

describe("calculatePeriodOvertime — the period is the unit, not the week", () => {
  it("a fortnight of exactly the contract earns nothing", () => {
    const days = [...week("2026-06-08", 9.8), ...week("2026-06-15", 9.8)];
    const r = calculatePeriodOvertime(days, "2026-06-08", "2026-06-21");
    expect(r.workedHours).toBe(88);
    expect(r.targetHours).toBe(88);
    expect(r.netOvertime).toBe(0);
  });

  it("a surplus week pays off a short week instead of being paid out", () => {
    // 32h then 56h. Week by week that is +12 owed and −12 docked; over the period it
    // is a fortnight in which somebody worked exactly their contract.
    const short = week("2026-06-08", 7.4);   // 5 × (7.4 − 1) = 32
    const long = week("2026-06-15", 12.2);   // 5 × (12.2 − 1) = 56
    const r = calculatePeriodOvertime([...short, ...long], "2026-06-08", "2026-06-21");
    expect(r.workedHours).toBe(88);
    expect(r.netOvertime).toBe(0);
  });

  it("keeps a genuine deficit negative", () => {
    // Sickness written off against banked hours is why the payroll sheet carries
    // balances as low as −68.5. A deficit is an answer, not bad data.
    const r = calculatePeriodOvertime(week("2026-06-08", 5), "2026-06-08", "2026-06-14");
    expect(r.workedHours).toBe(20);
    expect(r.netOvertime).toBe(-24);
  });

  it("pays a weekend shift without deducting a break from it", () => {
    const days = [...week("2026-06-08", 9.8), day("2026-06-13", 8, false)];
    const r = calculatePeriodOvertime(days, "2026-06-08", "2026-06-14");
    expect(r.workedHours).toBe(52);       // 44 scheduled + 8 untouched
    expect(r.netOvertime).toBe(8);
    expect(r.overtimeDays).toBe(1);
    expect(r.scheduledDays).toBe(5);
  });

  it("excused hours lower the target rather than creating a deficit", () => {
    // A certified week off should neither earn overtime nor put somebody in debt.
    const r = calculatePeriodOvertime(week("2026-06-08", 9.8), "2026-06-08", "2026-06-21", {
      excusedHours: 44,
    });
    expect(r.targetHours).toBe(44);
    expect(r.netOvertime).toBe(0);
  });

  it("ignores days outside the period", () => {
    const days = [...week("2026-06-01", 9.8), ...week("2026-06-08", 9.8)];
    const r = calculatePeriodOvertime(days, "2026-06-08", "2026-06-14");
    expect(r.workedHours).toBe(44);
    expect(r.scheduledDays).toBe(5);
  });

  it("measures the real 08 Jun – 12 Jul period as five weeks", () => {
    const r = calculatePeriodOvertime([], "2026-06-08", "2026-07-12");
    expect(r.weeks).toBe(5);
    expect(r.targetHours).toBe(220);
  });

  it("handles a period that is not a whole number of weeks", () => {
    const r = calculatePeriodOvertime([], "2026-06-08", "2026-06-18"); // 11 days
    expect(r.weeks).toBeCloseTo(1.57, 2);
    expect(r.targetHours).toBeCloseTo(69.14, 1);
  });

  it("reports the break total separately from the hours worked", () => {
    const r = calculatePeriodOvertime(week("2026-06-08", 9.8), "2026-06-08", "2026-06-14");
    expect(r.rawHours).toBe(49);
    expect(r.breakHours).toBe(5);
    expect(r.workedHours).toBe(44);
  });

  it("refuses a period that ends before it starts", () => {
    expect(() => calculatePeriodOvertime([], "2026-07-12", "2026-06-08")).toThrow(/ends before/);
  });

  it("uses 44 hours and one hour of break by default", () => {
    expect(DEFAULT_RULES).toEqual({ weeklyTargetHours: 44, breakHours: 1 });
  });
});
