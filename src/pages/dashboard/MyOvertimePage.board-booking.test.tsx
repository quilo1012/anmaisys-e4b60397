/**
 * Overtime the office put on the Headcount by hand reaches My Overtime as a booking.
 *
 * 30/10/2026: Ailton Junior was on Line 2 as overtime for Sat 31/10. Where I'm working
 * showed it; My Overtime said 0 Accepted and listed nothing for that day, because it
 * read only answers to asks and there was no ask behind the placement.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/workforce/MessageSupervisorDialog", () => ({
  MessageSupervisorDialog: () => <button type="button">Message supervisor</button>,
}));
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/SignupQrCard", () => ({ SignupQrCard: () => null }));
vi.mock("@/components/workforce/OvertimePushNudge", () => ({ OvertimePushNudge: () => null }));
vi.mock("@/components/workforce/OvertimeAuditLog", () => ({ OvertimeAuditLog: () => null }));
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => false }));

const iso = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const TODAY = iso(0);
const TOMORROW = iso(1);
vi.mock("@/lib/operationalShift", () => ({ currentShift: () => ({ operationalDate: TODAY }) }));

const ask = (id: string, on_date: string) => ({
  id, on_date, starts_at: "06:00:00", ends_at: "18:00:00", headcount: null, department: null, shift_group: null,
  note: null, status: "open", created_by: "u", created_at: "", closed_at: null,
});

const state = vi.hoisted(() => ({
  asks: [] as unknown[],
  board: [] as unknown[],
  attendance: vi.fn(),
}));

vi.mock("@/hooks/useMyAttendance", () => ({ useMyAttendance: state.attendance }));
vi.mock("@/hooks/useOvertimeRequests", () => ({
  useMyEmployee: () => ({
    data: { id: "e-003", full_name: "Ailton Junior", department: "Production", shift_group: "Day" },
    isPending: false, isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useMyUpcomingOvertime: () => ({ data: state.asks, isLoading: false }),
  useOvertimeResponses: () => ({ data: [] }),
  useMyOvertimeBlock: () => ({ data: null }),
  useMyOvertimeClashes: () => ({ data: new Map() }),
  useOvertimePlaces: () => ({ data: undefined }),
  useOvertimeOutcomesFor: () => ({ data: [] }),
  useOvertimeMutations: () => ({
    answer: { mutate: vi.fn(), isPending: false },
    cancelMyBooking: { mutate: vi.fn(), isPending: false },
    swapMyBooking: { mutate: vi.fn(), isPending: false },
    leaveReserve: { mutate: vi.fn(), isPending: false },
    rebookMyBooking: { mutate: vi.fn(), isPending: false },
    linkMe: { mutate: vi.fn(), isPending: false },
    linkMeByEmail: { mutate: vi.fn(), isPending: false },
  }),
}));

import MyOvertimePage from "@/pages/dashboard/MyOvertimePage";

function attendanceWith(board: unknown[], overtime: unknown[] = []) {
  return {
    data: {
      state: "ready",
      data: {
        me: { id: "e-003", full_name: "Ailton Junior", employee_ref: "E003", department: "Production", position: null, shift_group: "Day", started_on: null },
        pattern: { name: "Tue–Fri days", days: [2, 3, 4, 5], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 0, annual_leave_days: null },
        clocks: [], clocked_to: null, clocks_imported_at: null, marks: [], holiday_marks: [],
        board, overtime, requests: [], payroll: [], periods: [],
      },
    },
  };
}
const line2Tomorrow = { on_date: TOMORROW, shift: "Day", status: "overtime", half_day: false, area: "Line 2", area_kind: "production", is_leader: false };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><MyOvertimePage /></MemoryRouter></QueryClientProvider>);
}
const counter = (label: string) => screen.getByRole("button", { name: new RegExp(`^\\d+\\s*${label}$`) });

describe("overtime placed on the Headcount by the office", () => {
  beforeEach(() => { state.asks = []; state.attendance.mockReset(); });

  it("is a booking: listed, counted as accepted, and where it is", () => {
    state.attendance.mockReturnValue(attendanceWith([line2Tomorrow]));
    renderPage();
    // Same read, same fortnight as Where I'm working.
    expect(state.attendance).toHaveBeenCalledWith(TODAY, iso(13));
    expect(within(counter("Accepted")).getByText("1")).toBeInTheDocument();
    const card = screen.getByTestId("board-booking");
    expect(card).toHaveTextContent("You're in");
    expect(card).toHaveTextContent("Line 2");
    expect(card).toHaveTextContent("06:00–18:00");
    expect(card).toHaveTextContent("Put on the Headcount by the office");
    // Nothing to answer and nothing to cancel on it.
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/No upcoming overtime/)).not.toBeInTheDocument();
  });

  it("shows under Accepted and not under Needs response", () => {
    state.asks = [ask("sun", iso(2))];
    state.attendance.mockReturnValue(attendanceWith([line2Tomorrow]));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Needs response" }));
    expect(screen.queryByTestId("board-booking")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));
    expect(screen.getByTestId("board-booking")).toBeInTheDocument();
    expect(screen.queryByText("Nothing in this view.")).not.toBeInTheDocument();
  });

  it("is not counted twice when the row is the bridge's for an ask already booked", () => {
    state.attendance.mockReturnValue(attendanceWith(
      [line2Tomorrow],
      [{ on_date: TOMORROW, starts_at: "06:00:00", ends_at: "18:00:00" }],
    ));
    renderPage();
    expect(screen.queryByTestId("board-booking")).not.toBeInTheDocument();
  });

  it("says nothing new while the board has not loaded", () => {
    state.attendance.mockReturnValue({ data: undefined });
    renderPage();
    expect(screen.getByText(/No upcoming overtime/)).toBeInTheDocument();
  });
});
