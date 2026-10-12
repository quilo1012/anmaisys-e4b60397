import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { planDay, type PlanInput } from "@/lib/headcountPlan";
import { buildHeadcountWorkbook, NO_LINE_COLUMN } from "@/lib/headcountSheet";
import type { Allocation, HeadcountArea, HeadcountEmployee } from "@/hooks/useHeadcount";
import type { RotaCover } from "@/lib/rotaStatus";

const emp = (id: string, full_name: string): HeadcountEmployee => ({
  id, full_name, shift_group: "Day", department: null, shift_pattern_id: "p",
});
const saved = (employee_id: string, on_date: string, status: string, area_id: string | null = null): Allocation => ({
  id: `s-${employee_id}-${on_date}`, on_date, shift: "Day", employee_id, area_id, status,
  half_day: false, left_early_at: null, arrived_late_at: null, note: null, is_leader: false,
});

const ROSTER = [
  emp("ana", "Ana Lima"), emp("bia", "Bia Rocha"), emp("caio", "Caio Dias"),
  emp("duda", "Duda Reis"), emp("night", "Nilo Noite"), emp("nobody", "Sem Rota"),
];

// Mon–Thu rota for everyone, except the night crew and one person with none on file.
const cover = (id: string, date: string): RotaCover => {
  const dow = new Date(`${date}T12:00:00`).getDay();
  if (id === "nobody") return { known: false, coversDay: false, onThisBoard: true };
  return { known: true, coversDay: dow >= 1 && dow <= 4, onThisBoard: id !== "night" };
};

const base = (over: Partial<PlanInput>): PlanInput => ({
  date: "2026-10-20", // a Tuesday
  shift: "Day",
  today: "2026-10-12",
  saved: [],
  roster: ROSTER,
  cover,
  matrix: { normal: new Map([["ana", "l1"]]), changeover: new Map([["ana", "l2"], ["bia", "l2"]]) },
  lastArea: new Map([["bia", "l1"], ["caio", "l1"]]),
  ...over,
});

describe("planDay", () => {
  it("fills a future day with everyone the rota puts on this board", () => {
    const p = planDay(base({}));
    const ids = p.allocations.map((a) => a.employee_id).sort();
    expect(ids).toEqual(["ana", "bia", "caio", "duda"]);
    expect(p.planned).toBe(true);
    expect(p.allocations.every((a) => a.planned && a.status === "assigned")).toBe(true);
  });

  it("places them by the matrix, then the last line, then nowhere", () => {
    const at = (id: string) => planDay(base({})).allocations.find((a) => a.employee_id === id)?.area_id;
    expect(at("ana")).toBe("l1");   // standard matrix on a Tuesday
    expect(at("bia")).toBe("l2");   // only in the changeover matrix: used rather than guessed
    expect(at("caio")).toBe("l1");  // not in any matrix: where they last worked
    expect(at("duda")).toBeNull();  // nothing known: printed under the no-line column
  });

  it("uses the changeover matrix on a Monday", () => {
    const p = planDay(base({ date: "2026-10-19" }));
    expect(p.allocations.find((a) => a.employee_id === "ana")?.area_id).toBe("l2");
  });

  it("keeps booked leave and overtime, and never also puts that person on a line", () => {
    const p = planDay(base({ saved: [saved("ana", "2026-10-20", "holiday"), saved("bia", "2026-10-20", "sick")] }));
    expect(p.allocations.filter((a) => a.employee_id === "ana")).toHaveLength(1);
    expect(p.allocations.find((a) => a.employee_id === "ana")?.status).toBe("holiday");
    expect(p.allocations.find((a) => a.employee_id === "bia")?.status).toBe("sick");
    expect(p.planned).toBe(true);
  });

  it("leaves alone a day a planner has already started", () => {
    const p = planDay(base({ saved: [saved("ana", "2026-10-20", "assigned", "l5")] }));
    expect(p.allocations).toHaveLength(1);
    expect(p.planned).toBe(false);
  });

  it("never fills today or the past", () => {
    expect(planDay(base({ date: "2026-10-12" })).allocations).toHaveLength(0);
    expect(planDay(base({ date: "2026-10-05" })).allocations).toHaveLength(0);
  });

  it("does not plan anyone on a day their rota does not cover", () => {
    expect(planDay(base({ date: "2026-10-23" })).allocations).toHaveLength(0); // Friday
  });

  it("counts people with no rota instead of guessing they are in", () => {
    const p = planDay(base({}));
    expect(p.allocations.some((a) => a.employee_id === "nobody")).toBe(false);
    expect(p.noRota).toBe(1);
  });
});

describe("the planned day on the sheet", () => {
  const area = (id: string, name: string): HeadcountArea => ({
    id, name, kind: "production", section: "main_lines", department: null, sort_order: 0, active: true,
  });
  const AREAS = [area("l1", "Line 1"), area("l2", "Line 2")];

  it("prints every planned name, the no-line ones included, and says the day is a plan", () => {
    const p = planDay(base({ saved: [saved("caio", "2026-10-20", "holiday")] }));
    const wb = buildHeadcountWorkbook({
      days: [{ date: "2026-10-20", shift: "Day" }],
      areas: AREAS,
      employeeById: new Map(ROSTER.map((e) => [e.id, e])),
      allocationsFor: () => p.allocations,
    });
    const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const cells = grid.flat().map(String);
    expect(cells[0]).toMatch(/planned from the rota/);
    for (const n of ["Ana Lima", "Bia Rocha", "Duda Reis", "Caio Dias"]) expect(cells).toContain(n);
    expect(cells).toContain(NO_LINE_COLUMN);
    const total = grid.find((r) => String(r[0]).startsWith("Total staff in Production"));
    expect(total?.[1]).toBe(3); // Ana, Bia on lines + Duda with no line; Caio is on holiday
  });
});
