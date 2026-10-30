/**
 * An employee can take back a confirmed booking. The page asks for confirmation,
 * calls cancel_my_overtime, and a cancelled booking reads "Cancelled by you" —
 * never "Booked" — with neither the cancel button nor the supervisor chat offered.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/workforce/MessageSupervisorDialog", () => ({
  MessageSupervisorDialog: () => <button type="button">Message supervisor</button>,
}));
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/SignupQrCard", () => ({ SignupQrCard: () => null }));
vi.mock("@/components/workforce/OvertimePushNudge", () => ({ OvertimePushNudge: () => null }));
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => false }));

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const ask = (id: string) => ({
  id, on_date: future(5), starts_at: "06:00:00", ends_at: "14:00:00", headcount: 1,
  department: null, shift_group: null, note: null, status: "open", created_by: "u",
  created_at: "", closed_at: null,
});
const booked = {
  id: "r1", request_id: "a1", employee_id: "e1", answer: "yes", decision: "accepted",
  answered_at: "2026-10-12T10:00:00Z", decided_at: "2026-10-12T10:00:00Z",
};

const state = vi.hoisted(() => ({
  responses: [] as unknown[],
  outcomes: [] as unknown[],
  cancelled: null as unknown,
}));

vi.mock("@/hooks/useOvertimeRequests", () => ({
  useMyEmployee: () => ({
    data: { id: "e1", full_name: "Ana Weekend", department: "Production", shift_group: "Day" },
    isPending: false, isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useMyUpcomingOvertime: () => ({ data: [ask("a1")], isLoading: false }),
  useOvertimeResponses: () => ({ data: state.responses }),
  useMyOvertimeBlock: () => ({ data: null }),
  useMyOvertimeClashes: () => ({ data: new Map() }),
  useOvertimePlaces: () => ({ data: undefined }),
  useOvertimeOutcomesFor: () => ({ data: state.outcomes }),
  useOvertimeMutations: () => ({
    answer: { mutate: vi.fn(), isPending: false },
    swapMyBooking: { mutate: vi.fn(), isPending: false },
    leaveReserve: { mutate: vi.fn(), isPending: false },
    rebookMyBooking: { mutate: vi.fn(), isPending: false },

    cancelMyBooking: {
      mutate: (v: unknown, o: { onSuccess?: (r: unknown) => void; onSettled?: () => void }) => {
        state.cancelled = v;
        o.onSuccess?.({ outcome: "cancelled_in_time", promotedEmployeeId: null });
        o.onSettled?.();
      },
      isPending: false,
    },
    linkMe: { mutate: vi.fn(), isPending: false },
    linkMeByEmail: { mutate: vi.fn(), isPending: false },
  }),
}));

import MyOvertimePage from "@/pages/dashboard/MyOvertimePage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><MemoryRouter><MyOvertimePage /></MemoryRouter></QueryClientProvider>,
  );
}

describe("cancelling a booking", () => {
  it("a confirmed booking offers Cancel booking, which asks before it acts", async () => {
    state.responses = [booked]; state.outcomes = []; state.cancelled = null;
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /cancel booking/i }));
    expect(state.cancelled).toBeNull(); // the dialog asks first
    fireEvent.click(screen.getByRole("button", { name: /yes, cancel it/i }));
    await waitFor(() => expect(state.cancelled).toEqual({ requestId: "a1" }));
    expect(toast.success).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Booking cancelled/), expect.anything(),
    );
  });

  it("keeping the booking in the dialog changes nothing", async () => {
    state.responses = [booked]; state.outcomes = []; state.cancelled = null;
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /cancel booking/i }));
    fireEvent.click(screen.getByRole("button", { name: /keep my booking/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(state.cancelled).toBeNull();
  });

  it("a cancelled booking says so, and offers neither cancel nor the chat", () => {
    state.responses = [booked];
    state.outcomes = [{ response_id: "r1", outcome: "cancelled_in_time" }];
    renderPage();
    expect(screen.getAllByText("Cancelled by you").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /cancel booking/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Message supervisor" })).not.toBeInTheDocument();
  });

  it("a reserve has nothing to cancel", () => {
    state.responses = [{ ...booked, decision: "reserve" }]; state.outcomes = [];
    renderPage();
    expect(screen.queryByRole("button", { name: /cancel booking/i })).not.toBeInTheDocument();
  });
});
