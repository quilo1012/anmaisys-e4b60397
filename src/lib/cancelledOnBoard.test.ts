import { describe, it, expect } from "vitest";
import { cancelledOnBoard, cancelledWhen, type CancelledAskRow } from "@/lib/boardOvertime";

const row = (employee_id: string, over: Partial<CancelledAskRow> = {}): CancelledAskRow => ({
  request_id: `q-${employee_id}`, employee_id, on_date: "2026-11-04", starts_at: "06:00:00", ends_at: "14:00:00",
  outcome: "cancelled_in_time", recorded_at: "2026-11-04T07:10:00Z", note: null, ...over,
});

describe("overtime cancelled for this board", () => {
  it("lists somebody who booked this board's overtime and then cancelled it", () => {
    const out = cancelledOnBoard([row("anthony")], "2026-11-04", "Day", new Map());
    expect(out).toEqual([{
      employeeId: "anthony", startsAt: "06:00", endsAt: "14:00", late: false,
      cancelledAt: "2026-11-04T07:10:00Z", note: null,
    }]);
  });

  it("marks a late cancellation, the one that leaves a gap on the line", () => {
    const [x] = cancelledOnBoard([row("a", { outcome: "cancelled_late" })], "2026-11-04", "Day", new Map());
    expect(x.late).toBe(true);
  });

  it("ignores outcomes that are not a cancellation", () => {
    const out = cancelledOnBoard(
      [row("a", { outcome: "attended" }), row("b", { outcome: "no_show" }), row("c", { outcome: "called_sick" })],
      "2026-11-04", "Day", new Map());
    expect(out).toEqual([]);
  });

  it("keeps to this board: a night ask is not on the day board", () => {
    const out = cancelledOnBoard([row("a", { starts_at: "18:00:00", ends_at: "22:00:00" })], "2026-11-04", "Day", new Map());
    expect(out).toEqual([]);
  });

  it("puts a 02:00 ask on the night board of the evening before", () => {
    const out = cancelledOnBoard([row("a", { on_date: "2026-11-05", starts_at: "02:00:00", ends_at: "06:00:00" })],
      "2026-11-04", "Night", new Map());
    expect(out.map((x) => x.employeeId)).toEqual(["a"]);
  });

  it("leaves out somebody who still holds another confirmed ask on this board", () => {
    const confirmed = new Map([["a", [{ request_id: "q2", employee_id: "a", on_date: "2026-11-04", starts_at: "10:00:00", ends_at: "14:00:00" }]]]);
    expect(cancelledOnBoard([row("a")], "2026-11-04", "Day", confirmed)).toEqual([]);
  });

  it("shows the most recent cancellation first", () => {
    const out = cancelledOnBoard([
      row("early", { recorded_at: "2026-11-03T18:00:00Z" }),
      row("recent", { recorded_at: "2026-11-04T06:30:00Z" }),
    ], "2026-11-04", "Day", new Map());
    expect(out.map((x) => x.employeeId)).toEqual(["recent", "early"]);
  });
});

describe("when it was cancelled, in factory time", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  it("says today with the time", () => {
    expect(cancelledWhen("2026-11-04T07:10:00Z", now)).toBe("today 07:10");
  });
  it("says yesterday with the time", () => {
    expect(cancelledWhen("2026-11-03T21:45:00Z", now)).toBe("yesterday 21:45");
  });
  it("names the day further back", () => {
    expect(cancelledWhen("2026-11-01T09:00:00Z", now)).toBe("Sun 01/11 09:00");
  });
  it("reads British Summer Time as the factory clock", () => {
    expect(cancelledWhen("2026-10-20T05:30:00Z", new Date("2026-10-20T12:00:00Z"))).toBe("today 06:30");
  });
});
