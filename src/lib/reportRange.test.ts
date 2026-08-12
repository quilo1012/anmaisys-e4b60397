import { describe, it, expect } from "vitest";
import { subDays, startOfDay } from "date-fns";
import { resolveReportRange, reportPeriodLabel, OPEN_RANGE_START } from "@/lib/reportRange";

const NOW = new Date("2026-08-11T14:30:00.000Z");

describe("resolveReportRange", () => {
  it("passes a bounded range through untouched", () => {
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-31T23:59:59.999Z");
    const r = resolveReportRange({ from, to }, NOW);
    expect(r.startDate).toEqual(from);
    expect(r.endDate).toEqual(to);
    expect(r.openStart).toBe(false);
  });

  /**
   * The regression this file exists for.
   *
   * "All time" is an open range — getPresetRange("all") returns {} and a test in
   * dateRangeFilter.test.ts pins that contract. Every report screen then wrote
   * `range.from ?? subDays(new Date(), 30)`, so the chip said "All time" and the
   * figures underneath were the last thirty days. Nothing on screen said so.
   */
  it("does not silently substitute thirty days for an open start", () => {
    const r = resolveReportRange({}, NOW);
    const thirtyDaysAgo = startOfDay(subDays(NOW, 30));
    expect(r.startDate.getTime()).toBeLessThan(thirtyDaysAgo.getTime());
    expect(r.openStart).toBe(true);
  });

  it("reaches back before any record this system can hold", () => {
    const r = resolveReportRange({}, NOW);
    // The oldest work order in production is dated 2026-04-28; the floor has to sit
    // below anything the factory could ever have recorded, not below today's data.
    expect(r.startDate.getTime()).toBeLessThanOrEqual(OPEN_RANGE_START.getTime());
    expect(r.startDate.getUTCFullYear()).toBeLessThanOrEqual(2000);
  });

  it("closes an open end at now, so no query asks for the future", () => {
    const r = resolveReportRange({ from: new Date("2026-07-01T00:00:00.000Z") }, NOW);
    expect(r.endDate.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    expect(r.endDate.getTime()).toBeLessThan(NOW.getTime() + 24 * 3_600_000);
    expect(r.openEnd).toBe(true);
  });

  it("never returns a start after its end", () => {
    for (const range of [{}, { from: new Date("2026-07-01") }, { to: NOW }]) {
      const r = resolveReportRange(range, NOW);
      expect(r.startDate.getTime()).toBeLessThanOrEqual(r.endDate.getTime());
    }
  });
});

describe("reportPeriodLabel", () => {
  it("says All time rather than printing the sentinel floor", () => {
    const label = reportPeriodLabel(resolveReportRange({}, NOW));
    expect(label).toContain("All time");
    // A report header reading "01/01/2000" is worse than the bug it replaced.
    expect(label).not.toContain("2000");
  });

  /** No TZ is pinned for the suite, so assert the shape of the date, not its digits. */
  it("still dates an all-time report, so a printed sheet can be filed", () => {
    const label = reportPeriodLabel(resolveReportRange({}, NOW));
    expect(label).toMatch(/\d{2}\/\d{2}\/2026/);
  });

  it("prints both ends of a bounded range", () => {
    const label = reportPeriodLabel(
      resolveReportRange({ from: new Date("2026-07-01T12:00:00Z"), to: new Date("2026-07-31T12:00:00Z") }, NOW),
    );
    expect(label).toContain("01/07/2026");
    expect(label).toContain("31/07/2026");
    expect(label).not.toContain("All time");
  });
});
