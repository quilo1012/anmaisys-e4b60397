import { describe, it, expect } from "vitest";
import { woKpis, pmDueSoon, staffingKpis, productionTotals } from "./departmentKpis";

const now = new Date("2026-10-15T12:00:00Z");
const day = new Date("2026-10-15T05:00:00Z");
const week = new Date("2026-10-12T05:00:00Z");

describe("woKpis", () => {
  it("splits open, in progress, stale and done", () => {
    const k = woKpis([
      { status: "open", priority: "high", created_at: "2026-10-10T00:00:00Z" },
      { status: "in_progress", priority: "low", created_at: "2026-10-15T10:00:00Z", line_stopped: true },
      { status: "closed", priority: "low", created_at: "2026-10-15T06:00:00Z", closed_at: "2026-10-15T08:00:00Z" },
      { status: "finished", priority: "low", created_at: "2026-10-13T06:00:00Z", finished_at: "2026-10-13T08:00:00Z" },
      { status: "force_closed", priority: "low", created_at: "2026-10-15T06:00:00Z", closed_at: "2026-10-15T08:00:00Z" },
    ], now, week, day);
    expect(k).toMatchObject({ open: 1, inProgress: 1, stale: 1, doneToday: 1, doneWeek: 2, lineDown: 1, highOpen: 1 });
  });
});

describe("pmDueSoon", () => {
  it("ignores inactive schedules", () => {
    expect(pmDueSoon([
      { next_due_at: "2026-10-14T00:00:00Z", active: true },
      { next_due_at: "2026-10-18T00:00:00Z", active: true },
      { next_due_at: "2026-10-14T00:00:00Z", active: false },
    ], now)).toEqual({ overdue: 1, soon: 1 });
  });
});

describe("staffingKpis", () => {
  it("counts a person once, working beats absence", () => {
    const k = staffingKpis([
      { employee_id: "a", status: "sick", area_id: null },
      { employee_id: "a", status: "assigned", area_id: "L1" },
      { employee_id: "b", status: "holiday", area_id: null },
      { employee_id: "c", status: "overtime", area_id: "L1" },
    ]);
    expect(k).toMatchObject({ planned: 3, working: 2, absent: 1, overtime: 1 });
    expect(k.absence.holiday).toBe(1);
    expect(k.byArea.L1).toBe(2);
  });
});

describe("productionTotals", () => {
  it("has no percentage without a target", () => {
    expect(productionTotals([{ target_qty: null, actual_qty: 5 }]).pct).toBeNull();
    expect(productionTotals([{ target_qty: 100, actual_qty: 80 }]).pct).toBe(80);
  });
});
