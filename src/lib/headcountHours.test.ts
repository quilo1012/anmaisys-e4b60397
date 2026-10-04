import { describe, it, expect } from "vitest";
import { allocationHours, hoursByArea, NO_AREA_KEY } from "@/lib/headcountHours";
import type { Allocation, HeadcountArea } from "@/hooks/useHeadcount";

const alloc = (p: Partial<Allocation>): Allocation => ({
  id: Math.random().toString(36).slice(2),
  on_date: "2026-10-01",
  shift: "Day",
  employee_id: "e1",
  area_id: "mix",
  status: "assigned",
  half_day: null,
  left_early_at: null,
  arrived_late_at: null,
  note: null,
  is_leader: null,
  ...p,
});

const AREAS: HeadcountArea[] = [
  { id: "mix", name: "Mixing", kind: "production", section: "production", department: null, sort_order: 1, active: true },
  { id: "pack", name: "Packing", kind: "production", section: "production", department: null, sort_order: 2, active: true },
];

describe("allocationHours", () => {
  it("counts a full shift as twelve hours", () => {
    expect(allocationHours(alloc({}), "Day")).toBe(12);
  });

  it("counts a half day as six", () => {
    expect(allocationHours(alloc({ half_day: true }), "Day")).toBe(6);
  });

  it("deducts a late arrival and an early finish", () => {
    // Elias Soares on 15/08: in at 07:00, home at 16:00.
    expect(allocationHours(alloc({ arrived_late_at: "07:00:00", left_early_at: "16:00:00" }), "Day")).toBe(9);
  });

  it("reads a night finish as the morning after, not as minus eighteen hours", () => {
    expect(allocationHours(alloc({ shift: "Night", left_early_at: "02:00:00" }), "Night")).toBe(8);
  });
});

describe("hoursByArea", () => {
  it("counts everybody placed, not only the ones with a column on the board", () => {
    // Pill Line was deactivated and `useHeadcountAreas` reads active areas only, so
    // the 101 placements still being made there — 2 to 4 of them a day as recently as
    // 01/10/2026 — had no row and were missing from the Total as well. The table said
    // 76 people on 30/09 when the board held 79.
    const { rows, totals } = hoursByArea({
      allocations: [
        alloc({ area_id: "mix", employee_id: "a" }),
        alloc({ area_id: "aa8a0382", employee_id: "b" }),
        alloc({ area_id: "aa8a0382", employee_id: "c" }),
      ],
      shift: "Day",
      areas: AREAS,
      areaNameById: new Map([["aa8a0382", "Pill Line"]]),
    });
    expect(totals.people).toBe(3);
    expect(totals.hours).toBe(36);
    const offBoard = rows.find((r) => r.offBoard);
    expect(offBoard?.area).toBe("Pill Line");
    expect(offBoard?.people).toBe(2);
  });

  it("names an area it cannot find rather than dropping it", () => {
    const { rows, totals } = hoursByArea({
      allocations: [alloc({ area_id: "gone", employee_id: "a" })],
      shift: "Day",
      areas: AREAS,
    });
    expect(totals.people).toBe(1);
    expect(rows[0].offBoard).toBe(true);
    expect(rows[0].area).toBe("Not on the board");
  });

  it("keeps a placement with no area at all, in its own row", () => {
    // 100 of these on the record. On 18/07 eight of the forty people placed had no
    // area, so a fifth of the shift was missing from a table that showed a Total.
    const { rows, totals } = hoursByArea({
      allocations: [
        alloc({ area_id: "mix", employee_id: "a" }),
        alloc({ area_id: null, employee_id: "b" }),
      ],
      shift: "Day",
      areas: AREAS,
    });
    expect(totals.people).toBe(2);
    const last = rows[rows.length - 1];
    expect(last.key).toBe(NO_AREA_KEY);
    expect(last.people).toBe(1);
    expect(last.offBoard).toBe(true);
  });

  it("leaves holiday, sick and unpaid out of the hours", () => {
    const { rows, totals } = hoursByArea({
      allocations: [
        alloc({ area_id: "mix", employee_id: "a" }),
        alloc({ area_id: "mix", employee_id: "b", status: "holiday" }),
        alloc({ area_id: null, employee_id: "c", status: "sick" }),
        alloc({ area_id: "mix", employee_id: "d", status: "unpaid" }),
        alloc({ area_id: "mix", employee_id: "e", status: "training" }),
      ],
      shift: "Day",
      areas: AREAS,
    });
    expect(totals.people).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it("keeps overtime apart from the shift's own hours", () => {
    const { rows, totals } = hoursByArea({
      allocations: [
        alloc({ area_id: "mix", employee_id: "a" }),
        alloc({ area_id: "mix", employee_id: "b", status: "overtime", half_day: true }),
      ],
      shift: "Day",
      areas: AREAS,
    });
    expect(rows[0]).toMatchObject({ area: "Mixing", people: 1, hours: 12, otPeople: 1, ot: 6 });
    expect(totals).toMatchObject({ people: 1, hours: 12, otPeople: 1, ot: 6 });
  });

  it("puts the board's own areas first, in the order the board gives them", () => {
    const { rows } = hoursByArea({
      allocations: [
        alloc({ area_id: null, employee_id: "a" }),
        alloc({ area_id: "pack", employee_id: "b" }),
        alloc({ area_id: "mix", employee_id: "c" }),
      ],
      shift: "Day",
      areas: AREAS,
    });
    expect(rows.map((r) => r.area)).toEqual(["Mixing", "Packing", "No area recorded"]);
  });

  it("has no rows and no total when nobody is placed", () => {
    const { rows, totals } = hoursByArea({ allocations: [], shift: "Day", areas: AREAS });
    expect(rows).toEqual([]);
    expect(totals).toEqual({ people: 0, hours: 0, otPeople: 0, ot: 0 });
  });
});
