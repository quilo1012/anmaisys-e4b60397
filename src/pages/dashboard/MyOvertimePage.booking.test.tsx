/**
 * Since BLOCO 102 a yes books the shift. The page says what the database wrote, not
 * what the button meant, and a booked shift is changed by messaging the supervisor.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
const ask = (id: string, starts_at: string, ends_at: string) => ({
  id, on_date: future(5), starts_at, ends_at, headcount: null, department: null, shift_group: null,
  note: null, status: "open", created_by: "u", created_at: "", closed_at: null,
});

const state = vi.hoisted(() => ({
  responses: [] as unknown[],
  clashes: new Map<string, string>(),
  places: undefined as Map<string, { taken: number; headcount: number | null }> | undefined,
  written: null as unknown,
}));

vi.mock("@/hooks/useOvertimeRequests", () => ({
  useMyEmployee: () => ({
    data: { id: "e1", full_name: "Ana Weekend", department: "Production", shift_group: "Weekend" },
    isPending: false, isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useMyUpcomingOvertime: () => ({
    data: [ask("sat-day", "06:00:00", "18:00:00"), ask("sat-night", "18:00:00", "06:00:00")],
    isLoading: false,
  }),
  useOvertimeResponses: () => ({ data: state.responses }),
  useMyOvertimeBlock: () => ({ data: null }),
  useMyOvertimeClashes: () => ({ data: state.clashes }),
  useOvertimePlaces: () => ({ data: state.places }),
  useOvertimeOutcomesFor: () => ({ data: [] }),
  useOvertimeMutations: () => ({
    cancelMyBooking: { mutate: vi.fn(), isPending: false },
    swapMyBooking: { mutate: vi.fn(), isPending: false },
    leaveReserve: { mutate: vi.fn(), isPending: false },
    answer: {
      // The database's own row comes back, as `answer_overtime` returns it.
      mutate: (_v: unknown, o: { onSuccess?: (row: unknown) => void; onSettled?: () => void }) => {
        o.onSuccess?.(state.written); o.onSettled?.();
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

describe("a yes is a booking", () => {
  it("says booked when the database booked it", () => {
    state.responses = []; state.written = { answer: "yes", decision: "accepted" };
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /yes, i can/i })[0]);
    expect(toast.success).toHaveBeenLastCalledWith(expect.stringMatching(/^You're booked for/),
      expect.objectContaining({ description: expect.stringMatching(/Your supervisor has been told/) }));
  });

  it("says reserve when the ask's number was already reached", () => {
    state.responses = []; state.written = { answer: "yes", decision: "reserve" };
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /yes, i can/i })[0]);
    expect(toast.success).toHaveBeenLastCalledWith(expect.stringMatching(/^You're on the reserve list/), expect.anything());
  });

  it("does not promise a booking the database did not make (block not pasted)", () => {
    state.responses = []; state.written = { answer: "yes", decision: null };
    renderPage();
    fireEvent.click(screen.getAllByRole("button", { name: /yes, i can/i })[0]);
    expect(toast.success).toHaveBeenLastCalledWith(expect.stringMatching(/^You said yes/),
      expect.objectContaining({ description: expect.stringMatching(/supervisor picks/) }));
  });

  it("a booked shift offers a message to the supervisor instead of Yes / No", () => {
    state.responses = [{
      id: "r1", request_id: "sat-day", employee_id: "e1", answer: "yes", decision: "accepted",
      answered_at: "2026-10-12T10:00:00Z", decided_at: "2026-10-12T10:00:00Z",
    }];
    renderPage();
    expect(screen.getByText("Booked — your supervisor has been told")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Message supervisor" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /yes, i can/i })).toHaveLength(1); // only the other ask
  });

  it("an ask with no number says nothing about how many", () => {
    state.responses = [];
    renderPage();
    expect(screen.queryByText(/people needed/)).not.toBeInTheDocument();
  });
});
