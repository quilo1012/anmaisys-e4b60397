import { describe, it, expect } from "vitest";
import { coverageFrom, CLOCK_STALE_DAYS } from "@/hooks/useClockCoverage";

const row = (last: string | null, rest: Partial<Parameters<typeof coverageFrom>[0]> = {}) => ({
  last_on_date: last,
  first_on_date: "2026-06-01",
  employees_covered: 99,
  active_employees: 211,
  rows_total: 5000,
  ...rest,
});

describe("coverageFrom", () => {
  it("counts the days between the last clocked day and the operational date", () => {
    expect(coverageFrom(row("2026-09-06"), "2026-10-02")?.daysBehind).toBe(26);
  });

  it("says today when the clock is up to date", () => {
    const c = coverageFrom(row("2026-10-05"), "2026-10-05");
    expect(c?.daysBehind).toBe(0);
    expect(c?.stale).toBe(false);
  });

  it("goes stale past a week", () => {
    expect(coverageFrom(row("2026-09-27"), "2026-10-05")?.stale).toBe(true);
    expect(coverageFrom(row("2026-09-28"), "2026-10-05")?.stale).toBe(false);
    expect(CLOCK_STALE_DAYS).toBe(7);
  });

  it("does not read a clock dated in the future as up to date", () => {
    // The live view on 05/10/2026: `last_on_date` is 11/10, six days ahead, because
    // `attendance_days` carries 210 rows dated after today. `Math.max(0, …)` turned
    // that into daysBehind = 0, so the note said "last imported 11 Oct — today" on
    // three screens, with no warning, about days nobody can have worked yet.
    const c = coverageFrom(row("2026-10-11"), "2026-10-05");
    expect(c?.daysBehind).toBe(-6);
    expect(c?.daysAhead).toBe(6);
    expect(c?.stale).toBe(false);
  });

  it("has no days ahead when the clock is behind", () => {
    expect(coverageFrom(row("2026-09-06"), "2026-10-02")?.daysAhead).toBeNull();
  });

  it("refuses to turn an unreadable date into a gap of nought", () => {
    // A zero here would read as "imported today", which is the one thing the note
    // exists to stop somebody believing.
    const c = coverageFrom(row("not-a-date"), "2026-10-05");
    expect(c?.daysBehind).toBeNull();
    expect(c?.daysAhead).toBeNull();
    expect(c?.stale).toBe(false);
  });

  it("is not stale on a table nobody has filled", () => {
    const c = coverageFrom(row(null), "2026-10-05");
    expect(c?.lastOnDate).toBeNull();
    expect(c?.daysBehind).toBeNull();
    expect(c?.stale).toBe(false);
  });

  it("carries the coverage figures through, zeroes included", () => {
    const c = coverageFrom(row("2026-10-05", { employees_covered: null, active_employees: null }), "2026-10-05");
    expect(c?.employeesCovered).toBe(0);
    expect(c?.activeEmployees).toBe(0);
  });

  it("is null when there was no row to read", () => {
    expect(coverageFrom(null, "2026-10-05")).toBeNull();
  });
});
