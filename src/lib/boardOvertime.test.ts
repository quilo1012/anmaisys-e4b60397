import { describe, it, expect } from "vitest";
import { boardSlotOf, askWindow, placementHours, type ConfirmedAsk } from "./boardOvertime";
import { hoursByArea } from "./headcountHours";
import type { Allocation, HeadcountArea } from "@/hooks/useHeadcount";

const D = "2026-10-24";
const NEXT = "2026-10-25";
const plain = { status: "assigned", half_day: null, left_early_at: null, arrived_late_at: null, overtime_request_id: null };
const ask = (id: string, on_date: string, starts_at: string, ends_at: string): ConfirmedAsk =>
  ({ request_id: id, employee_id: "e", on_date, starts_at, ends_at });

describe("which board an ask belongs to", () => {
  it("splits at 06:00 and 18:00, and puts the small hours on the night before", () => {
    expect(boardSlotOf(D, "12:00:00")).toEqual({ date: D, shift: "Day" });
    expect(boardSlotOf(D, "18:00")).toEqual({ date: D, shift: "Night" });
    expect(boardSlotOf(NEXT, "02:00")).toEqual({ date: D, shift: "Night" });
  });
  it("runs a window past midnight into the next day", () => {
    expect(askWindow(ask("n", D, "18:00", "06:00"), D)).toEqual([1080, 1800]);
    expect(askWindow(ask("m", NEXT, "02:00", "04:00"), D)).toEqual([1560, 1680]);
  });
});

describe("a placement with confirmed overtime", () => {
  it("1. a half day stretched to 14:00 reads 06:00–14:00, 8h, 2 of them overtime", () => {
    const h = placementHours({ ...plain, half_day: true }, D, "Day", [ask("a", D, "12:00", "14:00")]);
    expect(h.label).toBe("06:00–14:00");
    expect(h.total).toBe(8);
    expect(h.base).toBe(6);
    expect(h.overtime).toBe(2);
    expect(h.shiftLabel).toBe("06:00–12:00");
    expect(h.short).toBe("06–14");
  });

  it("2. a half day made into a 12-hour day reads 06:00–18:00, 12h", () => {
    const h = placementHours({ ...plain, half_day: true }, D, "Day", [ask("a", D, "12:00", "18:00")]);
    expect(h.label).toBe("06:00–18:00");
    expect(h.total).toBe(12);
    expect(h.overtime).toBe(6);
  });

  it("3. an early finish followed by overtime is the actual end, not the shift's", () => {
    const h = placementHours({ ...plain, left_early_at: "12:00" }, D, "Day", [ask("a", D, "12:00", "14:00")]);
    expect(h.label).toBe("06:00–14:00");
  });

  it("4. overlapping hours are not counted twice", () => {
    const h = placementHours(plain, D, "Day", [ask("a", D, "16:00", "18:00")]);
    expect(h.total).toBe(12);
    expect(h.overtime).toBe(0);
  });

  it("5. a gap stays a gap", () => {
    const h = placementHours({ ...plain, half_day: true }, D, "Day", [ask("a", D, "14:00", "16:00")]);
    expect(h.label).toBe("06:00–12:00 + 14:00–16:00");
    expect(h.short).toBe("06–12+14–16");
    expect(h.total).toBe(8);
  });

  it("6. the bridge's own row is the ask's hours, not a 12-hour shift", () => {
    const h = placementHours({ ...plain, status: "overtime", overtime_request_id: "a" }, D, "Day", [ask("a", D, "06:00", "10:00")]);
    expect(h.total).toBe(4);
    expect(h.label).toBe("06:00–10:00");
    expect(h.shiftLabel).toBeNull();
  });

  it("7. overnight: a night shift stretched to 08:00 the next morning", () => {
    const h = placementHours(plain, D, "Night", [ask("a", NEXT, "06:00", "08:00")]);
    // 06:00 starts the next Day board, so it is not this night's — the night stays 12h.
    expect(h.total).toBe(12);
    const early = placementHours({ ...plain, left_early_at: "02:00" }, D, "Night", [ask("b", NEXT, "02:00", "05:00")]);
    expect(early.label).toBe("18:00–05:00");
    expect(placementHours(plain, D, "Day", [ask("c", D, "18:00", "18:30")]).short).toBe("06–18");
    expect(placementHours({ ...plain, status: "overtime", overtime_request_id: "d" }, D, "Day", [ask("d", D, "06:30", "14:00")]).short).toBe("06:30–14");
    expect(early.total).toBe(11);
  });

  it("8. an ask for another board does not reach this one", () => {
    const h = placementHours(plain, D, "Day", [ask("a", D, "18:00", "20:00")]);
    expect(h.overtimeLabels).toEqual([]);
    expect(h.total).toBe(12);
  });
});

describe("the hours table with confirmed overtime", () => {
  const areas: HeadcountArea[] = [{ id: "L1", name: "Line 1", kind: "production" } as HeadcountArea];
  const row = (employee_id: string, extra: Partial<Allocation>): Allocation => ({
    id: employee_id, on_date: D, shift: "Day", employee_id, area_id: "L1", status: "assigned",
    half_day: null, left_early_at: null, arrived_late_at: null, note: null, is_leader: null, ...extra,
  });

  it("counts the stretch as overtime once, and a bridge row as its ask's hours", () => {
    const allocations = [
      row("ana", { half_day: true }),
      row("rui", { status: "overtime", overtime_request_id: "q2" }),
      row("eva", {}),
    ];
    const confirmedAsks = new Map([
      ["ana", [{ ...ask("q1", D, "12:00", "14:00"), employee_id: "ana" }]],
      ["rui", [{ ...ask("q2", D, "06:00", "10:00"), employee_id: "rui" }]],
    ]);
    const { totals } = hoursByArea({ allocations, shift: "Day", areas, boardDate: D, confirmedAsks });
    expect(totals.people).toBe(2);      // Ana and Eva on the shift
    expect(totals.hours).toBe(6 + 12);  // Ana's half day, Eva's day
    expect(totals.otPeople).toBe(2);    // Ana's stretch, Rui's ask
    expect(totals.ot).toBe(2 + 4);
  });

  it("without the asks, reads as it always did", () => {
    const { totals } = hoursByArea({ allocations: [row("rui", { status: "overtime", overtime_request_id: "q2" })], shift: "Day", areas });
    expect(totals.ot).toBe(12);
  });
});
