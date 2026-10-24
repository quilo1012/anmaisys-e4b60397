/**
 * A no is not final while the ask is open. An employee who declined and then changed
 * their mind presses the same button; the row changes (one answer per person per ask,
 * the database upserts it) and the page says it changed and what came of it.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
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
  sent: [] as unknown[],
  refusal: null as string | null,
}));

vi.mock("@/hooks/useOvertimeRequests", () => ({
  useMyEmployee: () => ({
    data: { id: "e1", full_name: "Ana Weekend", department: "Production", shift_group: "Weekend" },
    isPending: false, isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useMyUpcomingOvertime: () => ({
    data: [ask("sat-day", "06:00:00", "18:00:00"), { ...ask("sat-night", "18:00:00", "06:00:00"), status: "closed" }],
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
      mutate: (v: unknown, o: { onSuccess?: (row: unknown) => void; onError?: (e: Error) => void; onSettled?: () => void }) => {
        state.sent.push(v);
        if (state.refusal) o.onError?.(new Error(state.refusal)); else o.onSuccess?.(state.written);
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

const declined = (request_id: string) => ({
  id: `r-${request_id}`, request_id, employee_id: "e1", answer: "no", decision: null,
  answered_at: "2026-10-20T10:00:00Z", decided_at: null,
});

describe("changing a no to a yes", () => {
  beforeEach(() => { state.sent = []; state.refusal = null; toast.success.mockReset(); toast.error.mockReset(); });

  it("offers the change on an open ask the person declined", () => {
    state.responses = [declined("sat-day")];
    renderPage();
    expect(screen.getByText(/You declined this. Changed your mind\? You can still accept while it is open./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change to accept/i })).toBeEnabled();
  });

  it("sends a yes for the same ask and says the answer changed and was booked", () => {
    state.responses = [declined("sat-day")];
    state.written = { answer: "yes", decision: "accepted" };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /change to accept/i }));
    expect(state.sent).toEqual([{ requestId: "sat-day", answer: "yes" }]);
    expect(toast.success).toHaveBeenLastCalledWith(expect.stringMatching(/^Answer changed to yes\. You're booked for/), expect.anything());
  });

  it("says reserve when the places filled while they were deciding", () => {
    state.responses = [declined("sat-day")];
    state.written = { answer: "yes", decision: "reserve" };
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /change to accept/i }));
    expect(toast.success).toHaveBeenLastCalledWith(expect.stringMatching(/^Answer changed to yes\. You're on the reserve list/), expect.anything());
  });

  it("shows the database's reason when the change is refused", () => {
    state.responses = [declined("sat-day")];
    state.refusal = "This overtime is no longer open";
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /change to accept/i }));
    expect(toast.error).toHaveBeenLastCalledWith("This overtime is no longer open", expect.anything());
  });

  it("keeps a declined ask that was closed, with no buttons and the reason", () => {
    state.responses = [declined("sat-night")];
    renderPage();
    expect(screen.getByText(/closed by your supervisor, so your answer can no longer be changed/)).toBeInTheDocument();
    // Only the open ask has buttons.
    expect(screen.getAllByRole("button", { name: /accept overtime|change to accept/i })).toHaveLength(1);
  });

  it("does not list a closed ask the person never answered", () => {
    state.responses = [];
    renderPage();
    expect(screen.queryByText(/closed by your supervisor/)).not.toBeInTheDocument();
  });
});
