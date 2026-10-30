/**
 * Employee-facing My Attendance: no holiday-left counter, payroll rows unchanged, and one
 * pay-period selector above the calendar that drives the whole page (30/10/2026).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { MyAttendanceData } from "@/lib/myAttendance";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const env = vi.hoisted(() => ({ attendance: vi.fn(), shifts: vi.fn() }));
vi.mock("@/hooks/useMyAttendance", () => ({ useMyAttendance: env.attendance }));
vi.mock("@/hooks/useMyOvertimeShifts", () => ({ useMyOvertimeShifts: env.shifts }));
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => false }));
vi.mock("@/lib/operationalShift", () => ({ currentShift: () => ({ operationalDate: "2026-10-30" }) }));

import MyAttendancePage from "@/pages/dashboard/MyAttendancePage";

const SEP = { id: "s", name: "September 2026", start_date: "2026-09-07", end_date: "2026-10-11" };
const OCT = { id: "o", name: "October 2026", start_date: "2026-10-12", end_date: "2026-11-08" };
const base = (payroll: MyAttendanceData["payroll"] = []): MyAttendanceData => ({
  me: { id: "e-1", full_name: "Ana Silva", employee_ref: "E045", department: "Production", position: null, shift_group: "Day", started_on: null },
  pattern: { name: "Mon–Thu days", days: [1, 2, 3, 4], starts_at: "06:00", ends_at: "18:00", break_minutes: 60, annual_leave_days: 22.5 },
  clocks: [], clocked_to: null, clocks_imported_at: null,
  marks: [], holiday_marks: ["2026-10-13"], board: [], requests: [], payroll, periods: [SEP, OCT],
});

function renderPage(data = base()) {
  env.attendance.mockReturnValue({ data: { state: "ready", data }, isLoading: false, isError: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><MyAttendancePage /></MemoryRouter></QueryClientProvider>);
}

describe("My Attendance — employee view", () => {
  beforeEach(() => { env.attendance.mockReset(); env.shifts.mockReturnValue({ data: undefined }); });

  it("shows no holiday-left counter", () => {
    renderPage();
    expect(screen.queryByText(/Holiday left/i)).toBeNull();
    expect(screen.queryByText(/taken · .* booked/)).toBeNull();
    expect(screen.getByText("Hours worked")).toBeInTheDocument();
    expect(screen.getAllByText("No record yet").length).toBeGreaterThan(0);
  });

  it("keeps the payroll row as it was, with and without a payroll figure", () => {
    const { unmount } = renderPage();
    const hours = screen.getByTestId("hours-balance");
    expect(hours).toHaveTextContent(/Approved by payroll\s*Not recorded yet/);
    expect(hours).toHaveTextContent("This is the figure that is paid.");
    unmount();
    renderPage(base([{ period_id: "o", hours: 7.5 }]));
    const h2 = screen.getByTestId("hours-balance");
    expect(h2).toHaveTextContent(/Approved by payroll\s*7.5 h/);
    expect(h2).not.toHaveTextContent(/Holiday left/i);
  });

  it("titles the period running today as This Pay Period and steps with ‹ ›", () => {
    renderPage();
    expect(screen.getByTestId("period-title")).toHaveTextContent("October 2026 (This Pay Period)");
    expect(screen.getByRole("button", { name: "Next pay period" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous pay period" }));
    expect(screen.getByTestId("period-title")).toHaveTextContent(/^September 2026$/);
    expect(screen.getByRole("button", { name: "Previous pay period" })).toBeDisabled();
    expect(env.attendance).toHaveBeenLastCalledWith("2026-09-07", "2026-10-11");
    expect(screen.getByTestId("calendar-span")).toHaveTextContent("2026-09-07..2026-10-11");
    expect(screen.getByTestId("hours-balance")).toHaveTextContent(/Overtime for September 2026/);
    fireEvent.click(screen.getByRole("button", { name: "Next pay period" }));
    expect(screen.getByTestId("period-title")).toHaveTextContent("October 2026 (This Pay Period)");
    expect(env.attendance).toHaveBeenLastCalledWith("2026-10-12", "2026-11-08");
    expect(screen.getByTestId("calendar-span")).toHaveTextContent("2026-10-12..2026-11-08");
    expect(screen.getByTestId("hours-balance")).toHaveTextContent(/Overtime for October 2026/);
  });

  it("has only one period selector on the page", () => {
    renderPage();
    expect(screen.queryByRole("combobox", { name: "Period" })).toBeNull();
    expect(screen.getAllByTestId("period-selector")).toHaveLength(1);
  });
});
