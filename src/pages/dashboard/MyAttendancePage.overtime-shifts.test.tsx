/**
 * "Overtime for October 2026: 0 h" on 30/10/2026, for somebody who had worked two
 * weekend overtime shifts. The figure is the finance close's and reads the clock alone;
 * his clock record stopped at 20/10. The page now shows the supervisor's record of the
 * shifts beside it, and says why the clock's figure does not have them yet.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { MyAttendanceData, MyOvertimeShiftRecord } from "@/lib/myAttendance";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const env = vi.hoisted(() => ({
  attendance: vi.fn(),
  shifts: vi.fn(),
}));
vi.mock("@/hooks/useMyAttendance", () => ({ useMyAttendance: env.attendance }));
vi.mock("@/hooks/useMyOvertimeShifts", () => ({ useMyOvertimeShifts: env.shifts }));
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => false }));
vi.mock("@/lib/operationalShift", () => ({ currentShift: () => ({ operationalDate: "2026-10-30" }) }));

import MyAttendancePage from "@/pages/dashboard/MyAttendancePage";

const PERIOD = { id: "p", name: "October 2026", start_date: "2026-10-12", end_date: "2026-11-08" };
const clock = (on_date: string) => ({
  on_date, start_time: "6:00", end_time: "18:00", worked_minutes: 720, balance_minutes: 0,
  scheduled_minutes: 720, overtime_adj_minutes: 0, absence_name: null,
});
const DATA: MyAttendanceData = {
  me: { id: "e-003", full_name: "Ailton Junior", employee_ref: "E003", department: "Production", position: "Team Leader", shift_group: "Day", started_on: null },
  pattern: { name: "Tue–Fri days", days: [2, 3, 4, 5], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 0, annual_leave_days: 22.5 },
  clocks: ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-20"].map(clock),
  clocked_to: "2026-10-20", clocks_imported_at: "2026-10-22T18:56:00Z",
  marks: [], holiday_marks: [], requests: [], payroll: [], periods: [PERIOD],
  board: [
    { on_date: "2026-10-30", shift: "Day", status: "assigned", half_day: false, area: "Line 6", area_kind: "production", is_leader: true },
    { on_date: "2026-10-31", shift: "Day", status: "overtime", half_day: false, area: "Line 2", area_kind: "production", is_leader: false },
  ],
  overtime: [],
};
const SHIFTS: MyOvertimeShiftRecord[] = [
  { on_date: "2026-10-24", starts_at: "06:00:00", ends_at: "18:00:00", outcome: "attended" },
  { on_date: "2026-10-25", starts_at: "06:00:00", ends_at: "14:00:00", outcome: "attended" },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><MyAttendancePage /></MemoryRouter></QueryClientProvider>);
}

describe("overtime shifts beside the clock's figure", () => {
  beforeEach(() => {
    env.attendance.mockReset().mockReturnValue({ data: { state: "ready", data: DATA }, isPending: false, isError: false });
    env.shifts.mockReset();
  });

  it("keeps the clock's 0 h, and says the clock does not reach the shifts yet", () => {
    env.shifts.mockReturnValue({ data: SHIFTS });
    renderPage();
    expect(env.shifts).toHaveBeenCalledWith("e-003", "2026-10-12", "2026-11-08");
    const hours = screen.getByTestId("hours-balance");
    expect(hours).toHaveTextContent(/Overtime for October 2026\s*0 h/);
    expect(hours).toHaveTextContent(/2 overtime shifts after that \(20 h\) are not in this figure yet/);
  });

  it("shows the supervisor's record: 20 h over two shifts, and the Headcount booking ahead", () => {
    env.shifts.mockReturnValue({ data: SHIFTS });
    renderPage();
    const box = screen.getByTestId("overtime-shifts");
    expect(box).toHaveTextContent(/Overtime shifts worked\s*20 h/);
    expect(box).toHaveTextContent("06:00–18:00");
    expect(box).toHaveTextContent("06:00–14:00");
    expect(box).toHaveTextContent(/Booked ahead.*06:00–18:00.*on the Headcount/);
  });

  it("adds nothing when there is no overtime to speak of", () => {
    env.attendance.mockReturnValue({ data: { state: "ready", data: { ...DATA, board: [] } }, isPending: false, isError: false });
    env.shifts.mockReturnValue({ data: [] });
    renderPage();
    expect(screen.queryByTestId("overtime-shifts")).not.toBeInTheDocument();
    expect(screen.getByTestId("hours-balance")).not.toHaveTextContent(/not in this figure yet/);
  });

  it("adds nothing while the shifts are loading", () => {
    env.shifts.mockReturnValue({ data: undefined });
    renderPage();
    expect(screen.queryByTestId("overtime-shifts")).not.toBeInTheDocument();
  });
});
