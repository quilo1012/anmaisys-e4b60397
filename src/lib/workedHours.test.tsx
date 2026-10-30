import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import XLSX from "xlsx-js-style";
import { workedWindow, chipHours, placementHours, type ConfirmedAsk } from "./boardOvertime";
import { printSheetLayout, buildHeadcountWorkbook } from "./headcountSheet";
import { buildBoardOvertime } from "./employeePanelHistory";
import { Chip } from "@/pages/dashboard/ProductionHeadcountPage";
import type { HeadcountArea, HeadcountEmployee, Allocation } from "@/hooks/useHeadcount";

const D = "2026-10-21";
const m = (t: string) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; };
const day: [number, number] = [m("06:00"), m("14:00")];
const night: [number, number] = [m("18:00"), m("18:00") + 720];
const marks = (left: string | null, arrived: string | null = null) => ({ left_early_at: left, arrived_late_at: arrived });

describe("workedWindow", () => {
  it("booked 06–14, left 18:00 → 06–18, a stay-late, not early", () => {
    const w = workedWindow(day, marks("18:00"));
    expect(w.window).toEqual([m("06:00"), m("18:00")]);
    expect(w.marks.stayLate).toBe(240);
    expect(w.marks.earlyFinish).toBe(0);
  });
  it("left 12:00 → 06–12, early", () => {
    const w = workedWindow(day, marks("12:00"));
    expect(w.window).toEqual([m("06:00"), m("12:00")]);
    expect(w.marks.earlyFinish).toBe(120);
    expect(w.marks.stayLate).toBe(0);
  });
  it("arrived 08:00 → 08–14 late start; arrived 05:00 → 05–14 early start", () => {
    const late = workedWindow(day, marks(null, "08:00"));
    expect(late.window).toEqual([m("08:00"), m("14:00")]);
    expect(late.marks.lateStart).toBe(120);
    const early = workedWindow(day, marks(null, "05:00"));
    expect(early.window).toEqual([m("05:00"), m("14:00")]);
    expect(early.marks.earlyStart).toBe(60);
  });
  it("night 18:00–06:00: left 02:00 is early, left 08:00 is a stay-late", () => {
    expect(workedWindow(night, marks("02:00")).marks).toMatchObject({ earlyFinish: 240, stayLate: 0 });
    expect(workedWindow(night, marks("08:00")).marks).toMatchObject({ stayLate: 120, earlyFinish: 0 });
  });
});

const ask = (id: string): ConfirmedAsk => ({ request_id: id, employee_id: "e", on_date: D, starts_at: "06:00:00", ends_at: "14:00:00" });
const otRow = (left: string | null) => ({
  status: "overtime", half_day: false, left_early_at: left, arrived_late_at: null, overtime_request_id: "f2a2",
});

describe("the board chip", () => {
  const draw = (left: string) => {
    const c = chipHours(otRow(left), D, "Day", [ask("f2a2")]);
    render(<Chip name="P" tone="overtime" draggable={false} onDragStart={() => {}} workHours={c.workHours} leftEarlyAt={c.leftEarlyAt} arrivedLateAt={c.arrivedLateAt} />);
  };
  it("Wilton-like: 06–18, no ←18:00", () => {
    draw("18:00:00");
    expect(screen.getByTestId("board-work-hours").textContent).toContain("06–18");
    expect(screen.queryByText("←18:00")).toBeNull();
    expect(screen.getByTestId("board-work-hours").getAttribute("title")).toContain("Booked 06:00–14:00, stayed until 18:00");
  });
  it("David-like: 06–16", () => {
    draw("16:00:00");
    expect(screen.getByTestId("board-work-hours").textContent).toContain("06–16");
    expect(screen.queryByText("←16:00")).toBeNull();
  });
  it("a real early finish still shows ←12:00", () => {
    draw("12:00:00");
    expect(screen.getByText("←12:00")).toBeTruthy();
  });
  it("a planned day row that stayed until 20:00 reads 06–20", () => {
    const h = placementHours({ ...otRow("20:00"), status: "assigned", overtime_request_id: null }, D, "Day", []);
    expect(h.short).toBe("06–20");
    expect(h.marks.stayLate).toBe(120);
  });
});

const AREAS = [{ id: "bt", name: "Blender Team", kind: "production", section: "production", sort_order: 1, active: true }] as unknown as HeadcountArea[];
const wilton = {
  id: "w", on_date: D, shift: "Day", employee_id: "w", area_id: "bt", status: "overtime", half_day: false,
  left_early_at: "18:00:00", arrived_late_at: null, overtime_request_id: "f2a2", note: null, is_leader: false,
  sheet_name: null, sheet_start_time: null, sheet_tag: null,
} as unknown as Allocation;
const byId = new Map([["w", { id: "w", full_name: "Wilton Azevedo", shift_group: "Day", active: true } as unknown as HeadcountEmployee]]);
const asks = new Map([["w", [ask("f2a2")]]]);

describe("paper and file", () => {
  it("prints the worked hours, not an early finish", () => {
    const l = printSheetLayout({ areas: AREAS, allocations: [wilton], employeeById: byId, boardDate: D, shift: "Day", confirmedAsks: asks });
    const n = l.top[0].names[0];
    expect(n.note).toBe("worked 06–18");
  });
  it("exports the worked hours", () => {
    const wb = buildHeadcountWorkbook({ days: [{ date: D, shift: "Day" }], areas: AREAS, employeeById: byId, allocationsFor: () => [wilton], asksFor: () => asks });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const cells = Object.values(ws).map((c) => (c as { v?: unknown })?.v).filter((v) => typeof v === "string") as string[];
    expect(cells).toContain("Wilton Azevedo (06–18)");
    expect(XLSX).toBeTruthy();
  });
});

describe("employee panel overtime", () => {
  it("shows worked hours and keeps the ask as booked", () => {
    const { lines } = buildBoardOvertime(
      [{ on_date: D, shift: "Day", area_name: "Blender Team", overtime_request_id: "f2a2", left_early_at: "18:00:00", arrived_late_at: null }],
      [{ request_id: "f2a2", on_date: D, starts_at: "06:00:00", ends_at: "14:00:00", outcome: "attended" }],
      [], "2026-10-30",
    );
    expect(lines[0].booked).toMatch(/06:00.*14:00/);
    expect(lines[0].hours).toMatch(/06:00.*18:00/);
  });
});
