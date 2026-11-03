import { describe, it, expect } from "vitest";
import { bookedNotOnBoard, type ConfirmedAsk } from "@/lib/boardOvertime";

const ask = (employee_id: string, starts_at = "06:00:00"): ConfirmedAsk => ({
  request_id: `q-${employee_id}`, employee_id, on_date: "2026-11-02", starts_at, ends_at: "18:00:00",
});
const confirmed = (...asks: ConfirmedAsk[]) =>
  new Map(asks.map((a) => [a.employee_id, [a]]));

describe("booked for overtime but not on the board", () => {
  it("finds somebody confirmed with no row on the board (Yuri, Mon 02/11)", () => {
    const out = bookedNotOnBoard(confirmed(ask("yuri"), ask("christian")),
      [{ employee_id: "christian", status: "overtime" }]);
    expect(out).toEqual([{ employeeId: "yuri", asks: [ask("yuri")], row: null }]);
  });

  it("finds somebody whose row on the board is an absence, and says which", () => {
    const out = bookedNotOnBoard(confirmed(ask("ana")), [{ employee_id: "ana", status: "holiday" }]);
    expect(out).toEqual([{ employeeId: "ana", asks: [ask("ana")], row: "holiday" }]);
  });

  it("leaves out anybody already working on the board, on a line or in Overtime", () => {
    const out = bookedNotOnBoard(confirmed(ask("a"), ask("b")), [
      { employee_id: "a", status: "assigned" },
      { employee_id: "b", status: "overtime" },
    ]);
    expect(out).toEqual([]);
  });

  it("is empty while the bookings have not been read", () => {
    expect(bookedNotOnBoard(undefined, [])).toEqual([]);
  });

  it("lists the earliest start first", () => {
    const out = bookedNotOnBoard(confirmed(ask("late", "10:00:00"), ask("early", "06:00:00")), []);
    expect(out.map((x) => x.employeeId)).toEqual(["early", "late"]);
  });
});
