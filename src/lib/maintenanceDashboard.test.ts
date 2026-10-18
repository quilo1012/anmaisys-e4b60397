import { describe, it, expect } from "vitest";
import { byPriority, byEngineer, byLine, typeSplit, notAccepted, stale, isHighPriority, NOT_ASSIGNED, NO_LINE } from "./maintenanceDashboard";

const now = new Date("2026-10-18T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe("maintenance dashboard groupings", () => {
  const rows = [
    { status: "open", priority: "high", engineer_name: null, line_at_time: "Line 1", wo_type: "production" },
    { status: "received", priority: "Critical", engineer_name: "Ana", line_at_time: "Line 1", wo_type: "production" },
    { status: "in_progress", priority: "medium", engineer_name: "Ana", line_at_time: null, wo_type: "preventive", started_at: hoursAgo(80) },
    { status: "in_progress", priority: null, engineer_name: "Rui", line_at_time: "Line 2", wo_type: null, started_at: hoursAgo(10) },
    { status: "arrived", priority: "urgent-ish", engineer_name: " ", line_at_time: "Line 2", wo_type: "production" },
  ];

  it("orders priority highest first, null as the column's default, unknown values last", () => {
    expect(byPriority(rows)).toEqual([
      { label: "critical", count: 1 }, { label: "high", count: 1 },
      { label: "medium", count: 2 }, { label: "urgent-ish", count: 1 },
    ]);
    expect(rows.filter(isHighPriority)).toHaveLength(2);
  });
  it("puts orders with no engineer under one name", () => {
    expect(byEngineer(rows)).toEqual([
      { label: "Ana", count: 2 }, { label: NOT_ASSIGNED, count: 2 }, { label: "Rui", count: 1 },
    ]);
  });
  it("groups by the line at the time, with a bucket for none", () => {
    expect(byLine(rows)).toEqual([
      { label: "Line 1", count: 2 }, { label: "Line 2", count: 2 }, { label: NO_LINE, count: 1 },
    ]);
  });
  it("counts a missing type as corrective, as the orders list does", () => {
    expect(typeSplit(rows)).toEqual({ corrective: 4, preventive: 1 });
  });
  it("says what is not accepted and what has been in progress over 72h", () => {
    expect(notAccepted(rows)).toBe(1);
    expect(stale(rows, now)).toBe(1);
  });
});
