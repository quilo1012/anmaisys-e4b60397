/**
 * The next booked overtime as a reminder with the time left (asked for 30/10/2026, 22:20).
 * The clock is fixed at that moment so the countdown can be read exactly.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
vi.mock("@/lib/operationalShift", () => ({ currentShift: () => ({ operationalDate: "2026-10-30" }) }));

const ask = (id: string, on_date: string, starts_at: string, ends_at: string) => ({
  id, on_date, starts_at, ends_at, headcount: null, department: null, shift_group: null,
  note: null, status: "open", created_by: "u", created_at: "", closed_at: null,
});
const accepted = (id: string, request_id: string) => ({
  id, request_id, employee_id: "e-026", answer: "yes", decision: "accepted",
  answered_at: "2026-10-27T10:00:00Z", decided_at: "2026-10-27T10:00:00Z",
});

const state = vi.hoisted(() => ({
  asks: [] as unknown[], responses: [] as unknown[], board: [] as unknown[],
}));
vi.mock("@/hooks/useMyAttendance", () => ({
  useMyAttendance: () => ({
    data: {
      state: "ready",
      data: {
        me: { id: "e-026", full_name: "Dimas Oliveira", employee_ref: "E026", department: "Production", position: null, shift_group: "Day", started_on: null },
        pattern: null, clocks: [], clocked_to: null, clocks_imported_at: null, marks: [], holiday_marks: [],
        board: state.board, overtime: [], requests: [], payroll: [], periods: [],
      },
    },
  }),
}));
vi.mock("@/hooks/useOvertimeRequests", () => ({
  useMyEmployee: () => ({
    data: { id: "e-026", full_name: "Dimas Oliveira", department: "Production", shift_group: "Day" },
    isPending: false, isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useMyUpcomingOvertime: () => ({ data: state.asks, isLoading: false }),
  useOvertimeResponses: () => ({ data: state.responses }),
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><MyOvertimePage /></MemoryRouter></QueryClientProvider>);
}

describe("the next booked overtime, as a reminder", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T22:20:00"));
    state.asks = []; state.responses = []; state.board = [];
  });
  afterEach(() => { vi.useRealTimers(); });

  it("shows the next booking with the time left to its start, its column and how many more", () => {
    state.asks = [ask("mon", "2026-11-02", "06:00:00", "18:00:00"), ask("tue", "2026-11-03", "06:00:00", "14:00:00")];
    state.responses = [accepted("r1", "mon"), accepted("r2", "tue")];
    state.board = [{ on_date: "2026-11-02", shift: "Day", status: "overtime", half_day: false, area: "Line 4", area_kind: "production", is_leader: false }];
    renderPage();
    const card = screen.getByTestId("next-overtime");
    expect(card).toHaveTextContent("Next overtime");
    expect(card).toHaveTextContent("06:00–18:00");
    expect(card).toHaveTextContent("Line 4");
    // Fri 22:20 → Mon 06:00 is 2 days, 7 hours and 40 minutes.
    expect(screen.getByTestId("next-overtime-countdown")).toHaveTextContent("2 d 7 h");
    expect(card).toHaveTextContent("+1 more booked");
  });

  it("puts a Headcount placement first when it is sooner, and says the office put it there", () => {
    state.asks = [ask("mon", "2026-11-02", "06:00:00", "18:00:00")];
    state.responses = [accepted("r1", "mon")];
    state.board = [{ on_date: "2026-10-31", shift: "Day", status: "overtime", half_day: false, area: "Line 2", area_kind: "production", is_leader: false }];
    renderPage();
    const card = screen.getByTestId("next-overtime");
    expect(card).toHaveTextContent("Line 2");
    expect(card).toHaveTextContent("Starts tomorrow at 06:00");
    expect(card).toHaveTextContent("Put on the Headcount by the office");
    expect(screen.getByTestId("next-overtime-countdown")).toHaveTextContent("7 h 40 min");
  });

  it("the more-booked link opens the Accepted list", () => {
    state.asks = [ask("mon", "2026-11-02", "06:00:00", "18:00:00"), ask("tue", "2026-11-03", "06:00:00", "14:00:00")];
    state.responses = [accepted("r1", "mon"), accepted("r2", "tue")];
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "+1 more booked" }));
    expect(screen.getByRole("button", { name: "Accepted", pressed: undefined })).toHaveClass("bg-primary");
  });

  it("is not there when nothing is booked — an ask only answered is not a booking", () => {
    state.asks = [ask("mon", "2026-11-02", "06:00:00", "18:00:00")];
    renderPage();
    expect(screen.queryByTestId("next-overtime")).not.toBeInTheDocument();
  });
});
