import { describe, it, expect } from "vitest";
import { accuracyByLine, actualTotals, frozenOnTime, targetVersusLogged, type StoredForecast } from "./smartTargetAccuracy";
import { ENGINE_VERSION } from "./smartTargetEngine";

const f = (over: Partial<StoredForecast>): StoredForecast => ({
  session_date: "2026-11-03", shift: "DAY", line: 2, shown: true, expected_total: 5000, frozen_at: "2026-11-03T06:30:00Z", ...over,
});

describe("frozenOnTime", () => {
  it("counts a forecast frozen in the first two hours of its shift, nights included", () => {
    expect(frozenOnTime(f({ frozen_at: "2026-11-03T08:00:00Z" }))).toBe(true);
    expect(frozenOnTime(f({ frozen_at: "2026-11-03T08:01:00Z" }))).toBe(false);
    expect(frozenOnTime(f({ shift: "NIGHT", frozen_at: "2026-11-03T19:45:00Z" }))).toBe(true);
    expect(frozenOnTime(f({ shift: "NIGHT", frozen_at: "2026-11-04T02:00:00Z" }))).toBe(false);
  });
});

describe("actualTotals", () => {
  it("adds up what was logged per line and shift, and leaves out shifts with nothing", () => {
    const m = actualTotals([
      { key: "2026-11-03|DAY|2", line: 2, made: [{ sku: "A", qty: 3000 }, { sku: "B", qty: 1500 }], netMinutes: 645, setupMinutes: 30 },
      { key: "2026-11-03|DAY|5", line: 5, made: [], netMinutes: 645, setupMinutes: 0 },
    ]);
    expect([...m]).toEqual([["2026-11-03|DAY|2", 4500]]);
  });
});

describe("accuracyByLine", () => {
  it("scores on-time forecasts with an actual, and counts the rest by reason", () => {
    const actuals = new Map([
      ["2026-11-03|DAY|2", 5000],
      ["2026-11-02|DAY|2", 4000],
      ["2026-11-02|NIGHT|2", 6000],
    ]);
    const [, l2] = accuracyByLine([
      f({}), // 5000 vs 5000 → 0%
      f({ session_date: "2026-11-02", expected_total: 4400, frozen_at: "2026-11-02T06:10:00Z" }), // +10%
      f({ session_date: "2026-11-02", shift: "NIGHT", expected_total: 4500, frozen_at: "2026-11-02T18:20:00Z" }), // −25%
      f({ session_date: "2026-11-01", frozen_at: "2026-11-01T13:00:00Z" }), // frozen late
      f({ session_date: "2026-10-31", expected_total: null, frozen_at: "2026-10-31T06:05:00Z" }), // no number
      f({ session_date: "2026-10-30", frozen_at: "2026-10-30T06:05:00Z" }), // nothing logged
    ], actuals);
    expect(l2).toMatchObject({ line: 2, scored: 3, frozenLate: 1, noNumber: 1, noActual: 1, medianAbsPctError: 10, within10: 2, within20: 2 });
    expect(l2.recent.map((r) => [r.date, r.shift, r.errorPct])).toEqual([
      ["2026-11-03", "DAY", 0],
      ["2026-11-02", "NIGHT", -25],
      ["2026-11-02", "DAY", 10],
    ]);
  });

  it("keeps a forecast resting on an estimate out of the score, and counts it (Q62a)", () => {
    const [, l2] = accuracyByLine([
      f({}),
      f({ session_date: "2026-11-02", frozen_at: "2026-11-02T06:10:00Z", jobs: [{ estimated: false }, { estimated: true }] }),
    ], new Map([["2026-11-03|DAY|2", 5000], ["2026-11-02|DAY|2", 1]]));
    expect(l2).toMatchObject({ scored: 1, estimated: 1, medianAbsPctError: 0 });
  });

  it("scores only the method in use, so 06/11's old numbers do not stand against the new rule", () => {
    const [, l2] = accuracyByLine([
      f({ engine_version: ENGINE_VERSION }),
      f({ session_date: "2026-11-02", frozen_at: "2026-11-02T06:10:00Z", engine_version: "smart-target-engine/1.0", expected_total: 99 }),
    ], new Map([["2026-11-03|DAY|2", 5000], ["2026-11-02|DAY|2", 5000]]));
    expect(l2).toMatchObject({ scored: 1, oldMethod: 1, medianAbsPctError: 0 });
  });

  it("has no error at all for a line with nothing scored", () => {
    expect(accuracyByLine([], new Map())[0]).toMatchObject({ scored: 0, medianAbsPctError: null });
  });
});

describe("the target against what was logged", () => {
  it("is the miss of the kept target, as Line 1 on 06/11: 2,903 against 1,432", () => {
    expect(targetVersusLogged(2903, 1432)).toBe(103);
    expect(targetVersusLogged(2505, 2769)).toBe(-10);
  });
  it("says nothing without a target or anything logged", () => {
    expect(targetVersusLogged(null, 100)).toBeNull();
    expect(targetVersusLogged(100, 0)).toBeNull();
  });
});
