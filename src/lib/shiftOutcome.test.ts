import { describe, it, expect } from "vitest";
import { endedBeforeHalfway, shiftOutcome, targetForHoursOpen } from "./shiftOutcome";

const t = (iso: string) => Date.parse(iso);
const base = { date: "2026-11-07", hasSession: true, logged: 86, run: undefined };

describe("shiftOutcome", () => {
  it("calls 07/11 night not run for Line 2: no shift opened, nothing logged, two hours in", () => {
    const night = { ...base, shift: "NIGHT" as const, hasSession: false, logged: 0 };
    expect(shiftOutcome({ ...night, nowMs: t("2026-11-07T17:00:00Z") })).toEqual({ kind: "upcoming" });
    expect(shiftOutcome({ ...night, nowMs: t("2026-11-07T19:30:00Z") })).toEqual({ kind: "upcoming" });
    expect(shiftOutcome({ ...night, nowMs: t("2026-11-07T20:14:00Z") })).toEqual({ kind: "not_run" });
    // A shift opened on the tablet ran, even before anything is logged (Lines 1, 3 and 6 that night).
    expect(shiftOutcome({ ...night, hasSession: true, nowMs: t("2026-11-07T20:14:00Z") }).kind).toBe("ran");
  });

  it("closes Line 2's 07/11 day at its last run, 12:40, once the shift is over", () => {
    const o = shiftOutcome({ ...base, shift: "DAY", run: { lastRunAt: "2026-11-07T12:40:00Z", heardUntil: "2026-11-07T17:55:00Z" }, nowMs: t("2026-11-07T20:00:00Z") });
    expect(o).toEqual({ kind: "ran", finishedAt: "2026-11-07T12:40:00.000Z", openMinutes: 400, grossMinutes: 720 });
    expect(targetForHoursOpen(2715, o)).toBe(1508);
    expect(endedBeforeHalfway(o)).toBe(false);
  });

  it("does not close a line while the shift runs, nor when the log went silent near the end", () => {
    const run = { lastRunAt: "2026-11-07T12:40:00Z", heardUntil: "2026-11-07T17:55:00Z" };
    expect(shiftOutcome({ ...base, shift: "DAY", run, nowMs: t("2026-11-07T15:00:00Z") })).toMatchObject({ finishedAt: null, openMinutes: 720 });
    // 06/11: the log stopped at 17:35, so a line quiet since 16:30 may have run on.
    const silent = { lastRunAt: "2026-11-06T16:30:00Z", heardUntil: "2026-11-06T17:00:00Z" };
    expect(shiftOutcome({ ...base, date: "2026-11-06", shift: "DAY", run: silent, nowMs: t("2026-11-07T08:00:00Z") })).toMatchObject({ finishedAt: null });
    // Running to within the hour is a full shift.
    const late = { lastRunAt: "2026-11-07T17:10:00Z", heardUntil: "2026-11-07T17:55:00Z" };
    expect(shiftOutcome({ ...base, shift: "DAY", run: late, nowMs: t("2026-11-07T20:00:00Z") })).toMatchObject({ finishedAt: null });
  });

  it("takes a shift that closed before half way out of the measurement", () => {
    const o = shiftOutcome({ ...base, shift: "DAY", run: { lastRunAt: "2026-11-07T09:00:00Z", heardUntil: "2026-11-07T17:55:00Z" }, nowMs: t("2026-11-07T20:00:00Z") });
    expect(endedBeforeHalfway(o)).toBe(true);
  });
});
