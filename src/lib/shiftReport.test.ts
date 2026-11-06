import { describe, it, expect } from "vitest";
import { lineReport, machineClock, reportRefreshMs, stopsByReason, type LineReportInput, type StatusRow } from "./shiftReport";
import { ENGINE_VERSION } from "./smartTargetEngine";

const at = (hhmm: string) => `2026-11-06T${hhmm}:00.000Z`;
const ms = (hhmm: string) => Date.parse(at(hhmm));
const s = (line: string, status: number, hhmm: string, day = 6): StatusRow => ({ line, status, changed_at: `2026-11-0${day}T${hhmm}:00.000Z` });

/** Another line's changes through the morning: the log alive, and nothing to do with Line 1. */
const alive = ["06:30", "07:10", "07:50", "08:30", "09:10", "09:30", "09:58"].map((t) => s("Line 2", 7, t));

describe("machineClock", () => {
  it("adds up the running states, holding the state from before the shift", () => {
    const rows = [s("Line 1", 4, "05:50"), s("Line 1", 7, "06:30"), s("Line 1", 8, "08:00"), s("Line 1", 6, "09:00"), ...alive];
    expect(machineClock(rows, "Line 1", ms("06:00"), ms("18:00"), ms("10:00"))).toEqual({
      firstRun: at("06:00"), lastRun: at("09:00"), runningMinutes: 90, coveredMinutes: 240, gaps: [],
    });
  });

  it("runs a line still running up to now while the log is alive elsewhere", () => {
    const rows = [s("Line 1", 4, "06:20"), ...alive];
    expect(machineClock(rows, "Line 1", ms("06:00"), ms("18:00"), ms("10:00"))).toMatchObject({ runningMinutes: 220, gaps: [] });
  });

  it("does not count the silence at the end of the day shift of 06/11, when the log stopped at 17:35", () => {
    const rows = [s("Line 1", 4, "17:00"), s("Line 2", 7, "17:35"), s("Line 2", 7, "21:15")];
    expect(machineClock(rows, "Line 1", ms("06:00"), ms("18:00"), ms("22:00"))).toMatchObject({
      runningMinutes: 35, lastRun: at("17:35"), coveredMinutes: 695, gaps: [{ from: at("17:35"), to: at("18:00") }],
    });
  });

  it("does not hold a running state across the silence into the night shift", () => {
    const rows = [s("Line 1", 4, "17:30"), s("Line 1", 4, "21:15"), s("Line 1", 7, "21:30")];
    expect(machineClock(rows, "Line 1", ms("18:00"), Date.parse("2026-11-07T06:00:00Z"), ms("22:00"))).toMatchObject({
      firstRun: at("21:15"), lastRun: at("21:30"), runningMinutes: 15, coveredMinutes: 45, gaps: [{ from: at("18:00"), to: at("21:15") }],
    });
  });

  it("calls a log still silent now a gap", () => {
    const rows = [s("Line 1", 4, "06:20")];
    expect(machineClock(rows, "Line 1", ms("06:00"), ms("18:00"), ms("10:00"))).toMatchObject({
      runningMinutes: 0, firstRun: null, coveredMinutes: 20, gaps: [{ from: at("06:20"), to: at("10:00") }],
    });
  });

  it("gives Line 2's real day of 06/11: 74 running minutes in short bursts, not a day's run", () => {
    const logged: [number, string][] = [[7, "06:08:00"], [4, "06:19:00"], [6, "06:20:00"], [4, "06:30:00"], [6, "06:31:00"], [4, "06:46:00"], [6, "06:47:00"], [7, "07:24:00"], [4, "07:34:00"], [6, "07:35:00"], [7, "07:38:00"], [7, "09:16:00"], [4, "09:30:00"], [6, "09:31:00"], [4, "09:35:00"], [6, "09:37:00"], [7, "10:04:00"], [6, "12:05:00"], [7, "12:11:00"], [4, "12:12:00"], [7, "12:14:02"], [7, "13:34:00"], [4, "13:35:00"], [6, "13:36:00"], [7, "13:44:00"], [4, "13:56:00"], [7, "13:59:00"], [7, "15:30:00"], [4, "15:51:00"], [6, "15:52:00"], [7, "15:54:00"], [4, "16:30:00"], [6, "16:31:00"], [4, "16:33:00"], [6, "16:35:02"], [4, "16:37:00"], [6, "16:55:00"], [4, "16:56:01"]];
    const line2 = logged.map(([status, t]) => ({ line: "Line 2", status, changed_at: `2026-11-06T${t}.000Z` }));
    const elsewhere = Array.from({ length: 24 }, (_, i) => s("Line 6", 7, `${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`));
    const rows = [...line2, ...elsewhere, s("Line 6", 7, "17:35"), s("Line 6", 7, "21:15")];
    expect(machineClock(rows, "Line 2", ms("06:00"), ms("18:00"), ms("22:00"))).toMatchObject({
      firstRun: at("06:19"), lastRun: at("17:35"), runningMinutes: 74, coveredMinutes: 695,
    });
  });

  it("is null with no change in the shift, instead of a zero", () => {
    expect(machineClock([s("Line 1", 4, "05:00")], "Line 1", ms("06:00"), ms("18:00"), ms("10:00"))).toBeNull();
    expect(machineClock([], "Line 1", ms("06:00"), ms("18:00"), ms("10:00"))).toBeNull();
  });
});

describe("reportRefreshMs", () => {
  const shift = { startMs: ms("06:00"), endMs: ms("18:00") };

  it("reads again only while the shift runs", () => {
    expect(reportRefreshMs(shift, ms("05:59"))).toBe(false);
    expect(reportRefreshMs(shift, ms("06:00"))).toBe(300_000);
    expect(reportRefreshMs(shift, ms("17:59"))).toBe(300_000);
    expect(reportRefreshMs(shift, ms("18:00"))).toBe(false);
    expect(reportRefreshMs(null, ms("12:00"))).toBe(false);
  });
});

describe("stopsByReason", () => {
  it("adds up one line and shift per reason, biggest first", () => {
    const row = (reason: string | null, duration_minutes: number | null, line = "Line 1", shift = "DAY") => ({ line, shift, reason, category: "Other", duration_minutes });
    expect(stopsByReason([row("Breaks", 40), row("Filling Blender", 100), row("Filling Blender", 72), row(null, 5), row("Breaks", 40), row("Alarm", 9, "Line 2"), row("Alarm", 9, "Line 1", "NIGHT"), row("Alarm", 0)], "Line 1", "DAY")).toEqual([
      { reason: "Filling Blender", minutes: 172 }, { reason: "Breaks", minutes: 80 }, { reason: "Other", minutes: 5 },
    ]);
  });
});

describe("lineReport", () => {
  const base: LineReportInput = {
    line: 1, target: 2903, targetSetAt: at("07:24"), targetVersion: "smart-target-engine/1.0", ragPlan: 1550, logged: 1432, miss: 103,
    planned: [{ sku: "EP16B", expected: 2903 }], made: [{ sku: "EP16B", qty: 1189 }, { sku: "EP16WCC", qty: 243 }],
    offPlan: ["EP16WCC"], stops: [{ reason: "Breaks", minutes: 80 }, { reason: "Filling Blender", minutes: 172 }],
    clock: { firstRun: at("06:20"), lastRun: at("17:35"), runningMinutes: 201, coveredMinutes: 695, gaps: [] }, grossMinutes: 720, leader: "Pedro", comment: null,
  };

  it("says why in plain sentences, naming the biggest stop that is not a break", () => {
    const r = lineReport(base);
    expect(r.why).toEqual([
      "Logged 1,471 under the target.",
      "This target came from an older method, so it does not count in the measurement.",
      "Ran products not in the plan: EP16WCC.",
      "Biggest stop: Filling Blender, 172 min.",
      "The machine ran 201 of the 695 minutes iTouch logged.",
    ]);
    expect(r.stopMinutes).toBe(252);
  });

  it("does not guess when there is nothing to go on", () => {
    const r = lineReport({ ...base, logged: 0, miss: null, target: null, targetVersion: ENGINE_VERSION, offPlan: [], stops: [], clock: null });
    expect(r.why).toEqual(["Nothing logged."]);
  });
});
