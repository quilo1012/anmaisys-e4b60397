import { describe, it, expect } from "vitest";
import { periodAround, rangeChoices } from "@/lib/myAttendance";

// The payroll calendar as configured in production on 30/10/2026.
const P = [
  { id: "aug", name: "August 2026", start_date: "2026-08-10", end_date: "2026-09-06" },
  { id: "sep", name: "September 2026", start_date: "2026-09-07", end_date: "2026-10-11" },
  { id: "oct", name: "October 2026", start_date: "2026-10-12", end_date: "2026-11-08" },
  { id: "nov", name: "November 2026", start_date: "2026-11-09", end_date: "2026-12-06" },
];
const TODAY = "2026-10-30";

describe("the pay period above the calendar", () => {
  it("names October 2026 as this pay period on 30/10, with September and November either side", () => {
    const a = periodAround(P, { from: "2026-10-12", to: "2026-11-08" }, TODAY);
    expect(a.period?.name).toBe("October 2026");
    expect(a.exact).toBe(true);
    expect(a.current).toBe(true);
    expect(a.prev?.name).toBe("September 2026");
    expect(a.next?.name).toBe("November 2026");
  });

  it("is not this pay period on a past one", () => {
    const a = periodAround(P, { from: "2026-09-07", to: "2026-10-11" }, TODAY);
    expect(a.current).toBe(false);
    expect(a.prev?.id).toBe("aug");
    expect(a.next?.id).toBe("oct");
  });

  it("stops at the ends of the configured calendar", () => {
    expect(periodAround(P, { from: "2026-08-10", to: "2026-09-06" }, TODAY).prev).toBeNull();
    expect(periodAround(P, { from: "2026-11-09", to: "2026-12-06" }, TODAY).next).toBeNull();
  });

  it("for a week inside a period, goes back to that whole period first", () => {
    const a = periodAround(P, { from: "2026-10-26", to: "2026-11-01" }, TODAY);
    expect(a.exact).toBe(false);
    expect(a.period?.id).toBe("oct");
    expect(a.prev?.id).toBe("oct");
    expect(a.next?.id).toBe("nov");
  });

  it("for a range outside every period, steps to the periods around it", () => {
    const a = periodAround(P, { from: "2026-07-01", to: "2026-07-31" }, TODAY);
    expect(a.period).toBeNull();
    expect(a.prev).toBeNull();
    expect(a.next?.id).toBe("aug");
  });

  it("labels the current period the same way in the selector", () => {
    expect(rangeChoices(P, TODAY)[0].label).toBe("October 2026 (This Pay Period)");
  });
});
