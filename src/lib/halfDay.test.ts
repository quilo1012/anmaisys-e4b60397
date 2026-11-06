import { describe, it, expect } from "vitest";
import { isHalfDay, holidayColumn, placementForDrop, replacedAbsence } from "./halfDay";
import { tallyBoard } from "./boardTally";
import { printSheetLayout, buildHeadcountWorkbook, parseHeadcountWorkbook } from "./headcountSheet";
import type { HeadcountArea, HeadcountEmployee, Allocation } from "@/hooks/useHeadcount";

const row = (employee_id: string, status: string, area_id: string | null, extra: Record<string, unknown> = {}) => ({
  id: employee_id, on_date: "2026-10-15", shift: "Day", employee_id, area_id, status,
  half_day: false, left_early_at: null, arrived_late_at: null, note: null, is_leader: false,
  sheet_name: null, sheet_start_time: null, sheet_tag: null, ...extra,
}) as unknown as Allocation;

const AREAS = [
  { id: "l1", name: "Line 1", kind: "production", section: "production", sort_order: 1, active: true },
  { id: "l2", name: "Line 2", kind: "production", section: "production", sort_order: 2, active: true },
] as unknown as HeadcountArea[];
const emp = (id: string, full_name: string) => ({ id, full_name, shift_group: "Day", active: true }) as unknown as HeadcountEmployee;
const PEOPLE = [emp("murilo", "Murilo Goncalves"), emp("karol", "Karoline Goncalves"), emp("ana", "Ana Paz"), emp("david", "David Goncalves")];
const byId = new Map(PEOPLE.map((p) => [p.id, p]));

const murilo = row("murilo", "assigned", "l1", { sheet_tag: "half day" });
const karoline = row("karol", "holiday", null, { sheet_tag: "half day" });
const fullHoliday = row("ana", "holiday", null);
const overtime = row("david", "overtime", "l2");

describe("isHalfDay", () => {
  it("reads half_day true as half", () => expect(isHalfDay({ half_day: true })).toBe(true));
  it.each(["half day", "HALF DAY", " Half  day "])("reads the sheet tag %j as half", (t) =>
    expect(isHalfDay({ half_day: false, sheet_tag: t })).toBe(true));
  it.each(["14:00", "training", "", null])("does not read %j as half", (t) =>
    expect(isHalfDay({ half_day: false, sheet_tag: t })).toBe(false));
});

describe("the Holidays column", () => {
  it("mirrors a half day worked on Line 1, and the person is counted once, on the line", () => {
    const all = [murilo, karoline, fullHoliday, overtime];
    const col = holidayColumn(all);
    expect(col.own.map((a) => a.employee_id)).toEqual(["karol", "ana"]);
    expect(col.mirrors.map((a) => a.employee_id)).toEqual(["murilo"]);
    expect(col.countLabel).toBe("2 + 1 half day");

    const t = tallyBoard({ allocations: all, areas: AREAS, roster: [], drawable: () => true });
    const without = tallyBoard({ allocations: all.filter((a) => a !== murilo), areas: AREAS, roster: [], drawable: () => true });
    expect(t.inProduction).toBe(without.inProduction + 1); // Murilo once, on Line 1
    expect(t.away.holiday).toBe(2);                         // Karoline + Ana, not Murilo
    expect(t.away.total).toBe(without.away.total);
  });

  it("leaves a full-day holiday and an overtime person where they were", () => {
    const col = holidayColumn([fullHoliday, overtime]);
    expect(col.own.map((a) => a.employee_id)).toEqual(["ana"]);
    expect(col.mirrors).toEqual([]);
    expect(col.countLabel).toBe("1");
  });
});

describe("dropping somebody", () => {
  it("puts Karoline on the line she worked, working, and keeps the half day", () => {
    expect(placementForDrop(karoline, { areaId: "l1", status: "assigned" }))
      .toEqual({ areaId: "l1", status: "assigned", halfDay: true, keptHalfDayOn: "l1" });
    // and the hook does not call that a replaced holiday
    expect(replacedAbsence("holiday", "assigned", true)).toBeNull();
  });

  it("still warns when a full-day holiday is replaced", () => {
    expect(placementForDrop(fullHoliday, { areaId: "l1", status: "assigned" })).toEqual({ areaId: "l1", status: "assigned" });
    expect(replacedAbsence("holiday", "assigned", false)).toBe("holiday");
  });

  it("moving Murilo's mirror moves his one row and keeps the half day", () => {
    expect(placementForDrop(murilo, { areaId: "l2", status: "assigned" })).toEqual({ areaId: "l2", status: "assigned", halfDay: true });
  });

  it("keeps overtime overtime on a line", () => {
    expect(placementForDrop(overtime, { areaId: "l1", status: "assigned" })).toEqual({ areaId: "l1", status: "overtime" });
  });
});

describe("paper and file", () => {
  it("prints the half-day person on Line 1 and in Holidays, counted once", () => {
    const l = printSheetLayout({ areas: AREAS, allocations: [murilo, fullHoliday], employeeById: byId });
    expect(l.top[0].names.map((n) => n.name)).toEqual(["Murilo Goncalves"]);
    const hol = l.bottom.find((c) => c.label === "Holidays")!;
    expect(hol.names.map((n) => n.name)).toEqual(["Ana Paz", "Murilo Goncalves"]);
    expect(hol.names.find((n) => n.name === "Murilo Goncalves")!.note).toBe("Half day");
    expect(l.totalStaff).toBe(1);
  });

  it("exports both columns and imports them back as one working half-day row", () => {
    const wb = buildHeadcountWorkbook({
      days: [{ date: "2026-10-15", shift: "Day" }], areas: AREAS, employeeById: byId,
      allocationsFor: () => [murilo, fullHoliday],
    });
    const p = parseHeadcountWorkbook(wb, { areas: AREAS, roster: PEOPLE, shift: "Day", fallbackYear: 2026 });
    const m = p.matched.filter((x) => x.employeeId === "murilo");
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ areaId: "l1", status: "assigned", sheetTag: "half day" });
    expect(p.matched.find((x) => x.employeeId === "ana")).toMatchObject({ status: "holiday" });
  });
});
