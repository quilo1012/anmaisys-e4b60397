import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useWorkforce", () => ({
  useMovements: () => ({ data: [] }),
  useRecentPlacements: () => ({ data: [], isLoading: false, isError: false }),
  useEmployeeBoardOvertime: () => ({
    board: { isLoading: false, isError: false, data: [
      { on_date: "2026-10-31", shift: "Day", area_name: "Line 2", overtime_request_id: null },
      { on_date: "2026-10-25", shift: "Day", area_name: "Line 1", overtime_request_id: "q1" },
    ] },
    asks: { isError: false, data: [
      { request_id: "q1", on_date: "2026-10-25", starts_at: "06:00:00", ends_at: "14:00:00", outcome: "attended" },
      { request_id: "q2", on_date: "2026-11-01", starts_at: "06:00:00", ends_at: "18:00:00", outcome: "cancelled_in_time" },
    ] },
    clock: { isError: false, data: [{ on_date: "2026-10-25", start_time: "05:55", end_time: "14:10", worked_minutes: 600, balance_minutes: 0 }] },
  }),
}));

import { BoardOvertimeSection, PositionTimelineSection } from "./EmployeeHistorySections";

describe("Overtime on the board with no payroll rows", () => {
  it("lists board overtime, Booked and Cancelled, and the clock separately", () => {
    render(<BoardOvertimeSection employeeId="e1" today="2026-10-30" />);
    expect(screen.queryByText(/no overtime/i)).toBeNull();
    expect(screen.getByText("Booked")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getByText("Attended")).toBeTruthy();
    expect(screen.getByText(/worked 10h/)).toBeTruthy();
    // One past board shift, one upcoming; the clock's 10h is not added in.
    expect(screen.getByTestId("ot-total").textContent).toBe("1");
    expect(screen.getByTestId("ot-upcoming").textContent).toBe("1");
  });
});

describe("Position timeline empty state", () => {
  it("says the current shift applies to every date", () => {
    const q = { data: [], isLoading: false, isError: false, refetch: () => {} };
    render(<PositionTimelineSection dated={q} record={q} patternName={() => "x"} />);
    expect(screen.getByText(/No dated changes — the current shift and rota apply to every date/)).toBeTruthy();
  });
});
