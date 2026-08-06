import { describe, it, expect } from "vitest";
import { cycleTotal } from "@/lib/woCycle";

// WO-2026-000511, as it actually is: opened 05:28, finished 06:23, signed off
// fifteen days later. The card read 362h 56m under the words "opened → finished".
const WO511 = {
  created_at: "2026-07-15T05:28:00Z",
  finished_at: "2026-07-15T06:23:00Z",
  closed_at: "2026-07-30T08:23:00Z",
  status: "closed",
};

describe("cycleTotal", () => {
  it("gives the repair time, not the wait for a signature", () => {
    const t = cycleTotal(WO511);
    expect(t.minutes).toBe(55);
    expect(t.label).toBe("opened → finished");
  });

  it("still reports the sign-off wait, as its own figure", () => {
    // 15/07 06:23 to 30/07 08:23 — fifteen days and two hours. A real problem, and
    // not a maintenance one; adding it to the repair time hides both.
    expect(cycleTotal(WO511).signOffWaitMinutes).toBe(15 * 24 * 60 + 120);
  });

  it("says nothing about a sign-off that followed straight on", () => {
    expect(cycleTotal({
      created_at: "2026-07-15T05:28:00Z",
      finished_at: "2026-07-15T06:23:00Z",
      closed_at: "2026-07-15T06:40:00Z",
      status: "closed",
    }).signOffWaitMinutes).toBeNull();
  });

  it("does not call a force-closed order finished", () => {
    const t = cycleTotal({
      created_at: "2026-07-15T05:28:00Z",
      closed_at: "2026-07-16T05:28:00Z",
      status: "force_closed",
    });
    expect(t.label).toBe("opened → force closed");
    expect(t.minutes).toBe(24 * 60);
  });

  it("does not borrow the word finished for an order that was only closed", () => {
    const t = cycleTotal({
      created_at: "2026-07-15T05:28:00Z",
      closed_at: "2026-07-15T09:28:00Z",
      status: "closed",
    });
    expect(t.label).toBe("opened → closed");
    expect(t.minutes).toBe(240);
  });

  it("leaves a running order without a total rather than measuring it against now", () => {
    const t = cycleTotal({ created_at: "2026-07-15T05:28:00Z", status: "open" });
    expect(t.minutes).toBeNull();
  });

  it("prefers finished_at over completed_at, and takes either", () => {
    expect(cycleTotal({
      created_at: "2026-07-15T05:00:00Z", completed_at: "2026-07-15T06:00:00Z", status: "closed",
    }).minutes).toBe(60);
  });

  it("returns null rather than a wild number when a timestamp is unreadable", () => {
    expect(cycleTotal({ created_at: "not a date", finished_at: "2026-07-15T06:23:00Z" }).minutes).toBeNull();
  });
});
