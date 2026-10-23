import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { refreshAfterOvertimeChange, OVERTIME_REFRESH_KEYS } from "@/hooks/useOvertimeRequests";

/**
 * Cancelling in My Overtime and then opening Where I'm working, inside the 30-second
 * stale time, used to show the cached day: `my_attendance` was never told the overtime
 * changed. Every overtime write now marks it stale, and the board's two reads as well.
 */
describe("an overtime change refreshes the screens that show it", () => {
  it("marks Where I'm working and the Headcount Board stale", () => {
    const qc = new QueryClient();
    const keys = [
      ["my_attendance", "user-1", "2026-10-23", "2026-11-05"],
      ["headcount-allocations", "2026-10-26", "Day"],
      ["headcount-confirmed-overtime", "2026-10-26", "Day"],
      ["overtime_outcomes", "all"],
    ];
    for (const k of keys) qc.setQueryData(k, { cached: true });
    refreshAfterOvertimeChange(qc);
    for (const k of keys) expect(qc.getQueryState(k)?.isInvalidated, k.join(" ")).toBe(true);
  });

  it("leaves unrelated reads alone", () => {
    const qc = new QueryClient();
    qc.setQueryData(["work_orders"], []);
    refreshAfterOvertimeChange(qc);
    expect(qc.getQueryState(["work_orders"])?.isInvalidated).toBe(false);
    expect(OVERTIME_REFRESH_KEYS.map((k) => k[0])).toContain("my_attendance");
  });
});
