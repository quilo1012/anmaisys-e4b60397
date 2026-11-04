import { describe, it, expect } from "vitest";
import { cancelledOnBoard, cancelledWhen, type CancelledAskRow, type ReservePromotion } from "@/lib/boardOvertime";

const row = (employee_id: string, over: Partial<CancelledAskRow> = {}): CancelledAskRow => ({
  request_id: `q-${employee_id}`, employee_id, on_date: "2026-11-04", starts_at: "06:00:00", ends_at: "14:00:00",
  outcome: "cancelled_in_time", recorded_at: "2026-11-04T07:10:00+00:00", note: null,
  recorded_by: `u-${employee_id}`, employee_user_id: `u-${employee_id}`, ...over,
});
const promoted = (request_id: string, employee_id: string, decided_at = "2026-11-04T07:10:00+00:00"): ReservePromotion =>
  ({ request_id, employee_id, decided_at });

describe("overtime cancelled for this board", () => {
  it("lists somebody who booked this board's overtime and then cancelled it", () => {
    const out = cancelledOnBoard([row("anthony")], "2026-11-04", "Day", new Map());
    expect(out).toEqual([{
      employeeId: "anthony", startsAt: "06:00", endsAt: "14:00", late: false,
      cancelledAt: "2026-11-04T07:10:00+00:00", note: null, bySupervisor: false, promotedTo: null,
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

  it("puts the ones that leave a gap first — late, or nobody took the place — then the most recent", () => {
    const out = cancelledOnBoard([
      row("filled-recent", { recorded_at: "2026-11-04T09:00:00+00:00" }),
      row("empty-old", { recorded_at: "2026-11-03T18:00:00+00:00" }),
      row("late-filled", { outcome: "cancelled_late", recorded_at: "2026-11-04T05:00:00+00:00" }),
      row("filled-old", { recorded_at: "2026-11-04T06:00:00+00:00" }),
    ], "2026-11-04", "Day", new Map(), [
      promoted("q-filled-recent", "r1", "2026-11-04T09:00:00+00:00"),
      promoted("q-late-filled", "r2", "2026-11-04T05:00:00+00:00"),
      promoted("q-filled-old", "r3", "2026-11-04T06:00:00+00:00"),
    ]);
    expect(out.map((x) => x.employeeId)).toEqual(["late-filled", "empty-old", "filled-recent", "filled-old"]);
  });
});

describe("who cancelled it", () => {
  it("says a supervisor cancelled when the record was written by another login", () => {
    const [x] = cancelledOnBoard([row("a", { recorded_by: "u-boss" })], "2026-11-04", "Day", new Map());
    expect(x.bySupervisor).toBe(true);
  });
  it("does not guess when the employee has no login linked", () => {
    const [x] = cancelledOnBoard([row("a", { recorded_by: "u-boss", employee_user_id: null })], "2026-11-04", "Day", new Map());
    expect(x.bySupervisor).toBe(false);
  });
});

describe("who took the place", () => {
  it("is the reserve on the same ask moved up in the same moment as the cancel", () => {
    const [x] = cancelledOnBoard([row("a")], "2026-11-04", "Day", new Map(), [
      promoted("q-a", "maria"),
      promoted("q-a", "earlier-yes", "2026-11-01T10:00:00+00:00"),
      promoted("q-other", "someone-else"),
    ]);
    expect(x.promotedTo).toBe("maria");
  });
  it("matches the moment whatever the timestamp's spelling", () => {
    const [x] = cancelledOnBoard([row("a", { recorded_at: "2026-11-04T07:10:00.123456+00:00" })], "2026-11-04", "Day", new Map(),
      [promoted("q-a", "maria", "2026-11-04T07:10:00.123+00:00")]);
    expect(x.promotedTo).toBe("maria");
  });
  it("is nobody when no reserve was moved up", () => {
    const [x] = cancelledOnBoard([row("a")], "2026-11-04", "Day", new Map(), []);
    expect(x.promotedTo).toBeNull();
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
