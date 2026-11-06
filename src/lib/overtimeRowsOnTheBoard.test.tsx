/**
 * The Headcount shows every `overtime` row as overtime.
 *
 * 06/11/2026, the owner: somebody who never accepted in the app and is added to the
 * board by hand is overtime. They read "Not accepted" (Claudia Prieto and Karoline
 * Goncalves on Gel Packing), out of the Overtime column and without the green. This
 * replaces the rule of 04/11, which counted only overtime backed by an accepted ask.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Chip } from "@/pages/dashboard/ProductionHeadcountPage";
import { boardTrend, tallyBoard } from "./boardTally";
import { printSheetLayout } from "./headcountSheet";

describe("tallyBoard", () => {
  const t = tallyBoard({
    allocations: [
      { employee_id: "normal", status: "assigned", area_id: "l1" },
      { employee_id: "byHand", status: "overtime", area_id: "l1" },
      { employee_id: "column", status: "overtime", area_id: null },
    ],
    areas: [{ id: "l1", kind: "production" }],
    roster: [],
    drawable: () => true,
  });

  it("counts every overtime row, with or without a yes", () => {
    expect(t.overtime).toBe(2);
  });

  it("keeps the person on a line in the line's total", () => {
    expect(t.inProduction).toBe(2);
    expect(t.working).toBe(1);
  });
});

describe("boardTrend", () => {
  it("counts an overtime row as overtime", () => {
    const [day] = boardTrend(
      [{ on_date: "2026-11-03", employee_id: "byHand", status: "overtime" }],
      "2026-11-03", "2026-11-03", () => true,
    );
    expect(day).toMatchObject({ overtime: 1, working: 0 });
  });
});

describe("the printed sheet", () => {
  it("lists an overtime row under Overtime staff", () => {
    const person = { id: "e1", full_name: "Zeca Lima", shift_group: "Day", department: null, shift_pattern_id: null };
    const allocation = {
      id: "a1", on_date: "2026-11-03", shift: "Day", employee_id: "e1", area_id: "l1", status: "overtime",
      half_day: false, left_early_at: null, arrived_late_at: null, note: null, is_leader: false,
    };
    const l = printSheetLayout({
      areas: [{ id: "l1", name: "Line 1", kind: "production", active: true, sort_order: 1 }] as never,
      allocations: [allocation] as never,
      employeeById: new Map([["e1", person]]),
    });
    expect(l.bottom.find((c) => c.label === "Overtime staff")!.names.map((n) => n.name)).toEqual(["Zeca Lima"]);
  });
});

describe("the board card", () => {
  it("has no 'Not accepted' mark", () => {
    render(<Chip name="P" tone="production" overtime draggable={false} onDragStart={() => {}} />);
    expect(screen.queryByText("Not accepted")).toBeNull();
    expect(screen.getByText("P").closest("[class*='92D050']")).not.toBeNull();
  });
});
