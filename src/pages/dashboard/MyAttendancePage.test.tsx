/**
 * My Attendance draws one person's record, and only from what the database returned for
 * that login. These pin the four states a page about a person must never confuse — no
 * function yet, no linked badge, a shared tablet, and a real record — and the two lines
 * that keep "recorded" apart from "paid".
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
const env = vi.hoisted(() => ({
  result: vi.fn(),
  shared: vi.fn(() => false),
}));
vi.mock("@/hooks/useMyAttendance", () => ({ useMyAttendance: env.result }));
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: env.shared }));
vi.mock("@/lib/operationalShift", () => ({ currentShift: () => ({ operationalDate: "2026-10-20" }) }));

import MyAttendancePage from "@/pages/dashboard/MyAttendancePage";

const PERIOD = { id: "p", name: "October 2026", start_date: "2026-10-12", end_date: "2026-11-08" };
const DATA: MyAttendanceData = {
  me: { id: "e-1", full_name: "Ana Silva", employee_ref: "E045", department: "Production", position: null, shift_group: "Day", started_on: null },
  pattern: { name: "Mon–Thu days", days: [1, 2, 3, 4], starts_at: "06:00", ends_at: "18:00", break_minutes: 60, annual_leave_days: 22.5 },
  clocks: [
    { on_date: "2026-10-12", start_time: "06:00", end_time: "19:30", worked_minutes: 750, balance_minutes: 90, scheduled_minutes: 660, overtime_adj_minutes: 0, absence_name: null },
  ],
  clocked_to: "2026-10-12", clocks_imported_at: "2026-10-13T08:00:00Z",
  marks: [], holiday_marks: [], board: [], requests: [], payroll: [], periods: [PERIOD],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><MemoryRouter><MyAttendancePage /></MemoryRouter></QueryClientProvider>,
  );
}

const ready = () => ({ data: { state: "ready", data: DATA }, isLoading: false, isError: false });

describe("My Attendance", () => {
  beforeEach(() => { env.result.mockReset(); env.shared.mockReturnValue(false); });

  it("says it is being set up, not an empty month, before the function exists", () => {
    env.result.mockReturnValue({ data: { state: "notSetUp" }, isLoading: false, isError: false });
    renderPage();
    expect(screen.getByText(/being set up/i)).toBeInTheDocument();
    expect(screen.queryByText(/Hours worked/i)).not.toBeInTheDocument();
  });

  it("says the badge is not linked, rather than showing anybody's record", () => {
    env.result.mockReturnValue({ data: { state: "unlinked" }, isLoading: false, isError: false });
    renderPage();
    expect(screen.getByText(/not linked to your badge/i)).toBeInTheDocument();
  });

  it("shows nobody's record on a shared line tablet, whatever the account is linked to", () => {
    env.shared.mockReturnValue(true);
    env.result.mockReturnValue(ready());
    renderPage();
    expect(screen.getByText(/signed in for the line/i)).toBeInTheDocument();
    expect(screen.queryByText("Ana Silva")).not.toBeInTheDocument();
  });

  it("opens on the pay period running today and settles overtime for it", () => {
    env.result.mockReturnValue(ready());
    renderPage();
    expect(screen.getByText(/Ana Silva/)).toBeInTheDocument();
    // The second call asks for the pay period, once the periods are known.
    expect(env.result).toHaveBeenLastCalledWith("2026-10-12", "2026-11-08");
    const hours = screen.getByTestId("hours-balance");
    expect(hours).toHaveTextContent(/Overtime for October 2026/);
    expect(hours).toHaveTextContent(/not yet approved or paid/i);
    expect(hours).toHaveTextContent(/Approved by payroll\s*Not recorded yet/);
  });

  it("says how far the clock record reaches and that later days are not absences", () => {
    env.result.mockReturnValue(ready());
    renderPage();
    expect(screen.getByTestId("freshness")).toHaveTextContent(/not as absences/i);
  });

  it("explains a rostered day with nothing recorded as not an absence", () => {
    env.result.mockReturnValue(ready());
    renderPage();
    // Tue 13/10 is on the rota, in the past, and nothing was recorded.
    fireEvent.click(screen.getByRole("button", { name: /(13 Oct|Oct 13).*No record yet/ }));
    expect(screen.getByTestId("day-detail")).toHaveTextContent(/not counted as an absence/i);
  });

  it("marks overtime on the present day itself", () => {
    env.result.mockReturnValue(ready());
    renderPage();
    expect(screen.getByRole("button", { name: /(12 Oct|Oct 12).*Present, overtime/ })).toBeInTheDocument();
  });
});
