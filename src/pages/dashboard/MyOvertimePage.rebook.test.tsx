/**
 * 29/10/2026: Rosana had booked Mon 02/11 06:00–18:00, cancelled it herself in time, and
 * then wanted to go after all. The card read "Cancelled by you" and had nothing to press.
 * BLOCO 138 lets a person book again what they cancelled in time, while the ask is open;
 * a late cancellation and a supervisor's stand. These are the card's side of it.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
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
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-me", email: "e129@example.invalid" } }),
}));

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const monday = {
  id: "mon", on_date: future(4), starts_at: "06:00:00", ends_at: "18:00:00", headcount: null,
  department: null, shift_group: null, note: null, status: "open", created_by: "u",
  created_at: "", closed_at: null,
};
const booked = {
  id: "r1", request_id: "mon", employee_id: "e1", answer: "yes", decision: "accepted",
  answered_at: "2026-10-27T10:41:21Z", decided_at: "2026-10-27T10:41:21Z",
};

const state = vi.hoisted(() => ({
  asks: [] as unknown[],
  outcomes: [] as unknown[],
  clashes: new Map<string, string>(),
  block: null as unknown,
  written: null as unknown,
  refusal: null as string | null,
  sent: [] as unknown[],
}));

vi.mock("@/hooks/useOvertimeRequests", () => ({
  useMyEmployee: () => ({
    data: { id: "e1", full_name: "Rosana Test", department: "Production", shift_group: "Day" },
    isPending: false, isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useMyUpcomingOvertime: () => ({ data: state.asks, isLoading: false }),
  useOvertimeResponses: () => ({ data: [booked] }),
  useMyOvertimeBlock: () => ({ data: state.block }),
  useMyOvertimeClashes: () => ({ data: state.clashes }),
  useOvertimePlaces: () => ({ data: undefined }),
  useOvertimeOutcomesFor: () => ({ data: state.outcomes }),
  useOvertimeMutations: () => ({
    answer: { mutate: vi.fn(), isPending: false },
    swapMyBooking: { mutate: vi.fn(), isPending: false },
    leaveReserve: { mutate: vi.fn(), isPending: false },
    cancelMyBooking: { mutate: vi.fn(), isPending: false },
    rebookMyBooking: {
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
const card = () => document.getElementById("ask-mon") as HTMLElement;
const mine = (outcome: string) => ({ response_id: "r1", outcome, note: null, recorded_by: "u-me" });
const desk = (outcome: string) => ({ response_id: "r1", outcome, note: null, recorded_by: "u-supervisor" });

describe("booking again what you cancelled", () => {
  beforeEach(() => {
    state.asks = [monday]; state.clashes = new Map(); state.block = null;
    state.written = null; state.refusal = null; state.sent = [];
    toast.success.mockReset(); toast.error.mockReset();
  });

  it("your own cancellation, in time, on an open ask: Book it again — and no cancel, no chat", () => {
    state.outcomes = [mine("cancelled_in_time")];
    renderPage();
    expect(within(card()).getAllByText("Cancelled by you").length).toBeGreaterThan(0);
    expect(within(card()).getByText(/You cancelled this booking. Changed your mind\?/)).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: /book it again/i })).toBeEnabled();
    expect(within(card()).queryByRole("button", { name: /cancel booking/i })).not.toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: "Message supervisor" })).not.toBeInTheDocument();
    // The screenshot of 29/10 read "Booked — your supervisor has been told" over "Cancelled by you".
    expect(within(card()).queryByText(/Booked — your supervisor has been told/)).not.toBeInTheDocument();
  });

  it("booked again: said as booked only when the database says accepted", () => {
    state.outcomes = [mine("cancelled_in_time")];
    state.written = { answer: "yes", decision: "accepted" };
    renderPage();
    fireEvent.click(within(card()).getByRole("button", { name: /book it again/i }));
    expect(state.sent).toEqual([{ requestId: "mon" }]);
    expect(toast.success).toHaveBeenLastCalledWith(expect.stringMatching(/^Booked again for/), expect.anything());
  });

  it("filled meanwhile: said as the reserve list, never booked", () => {
    state.outcomes = [mine("cancelled_in_time")];
    state.written = { answer: "yes", decision: "reserve" };
    renderPage();
    fireEvent.click(within(card()).getByRole("button", { name: /book it again/i }));
    const [title] = toast.success.mock.lastCall!;
    expect(title).toMatch(/^You're on the reserve list for/);
    expect(title).not.toMatch(/booked/i);
  });

  it("refused: the database's reason, and nothing changed", () => {
    state.outcomes = [mine("cancelled_in_time")];
    state.refusal = "You can't sign up for overtime until 31/10. (Missed overtime on 29/10.)";
    renderPage();
    fireEvent.click(within(card()).getByRole("button", { name: /book it again/i }));
    expect(toast.error).toHaveBeenLastCalledWith(state.refusal, { description: "Nothing was changed." });
  });

  it("a late cancellation stands: no button, the reason, and the way to the supervisor", () => {
    state.outcomes = [mine("cancelled_late")];
    renderPage();
    expect(within(card()).queryByRole("button", { name: /book it again/i })).not.toBeInTheDocument();
    expect(within(card()).getByText(/You cancelled this late, so the cancellation stands/)).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: "Message supervisor" })).toBeInTheDocument();
  });

  it("a supervisor's cancellation is called theirs, and is theirs to undo", () => {
    state.outcomes = [desk("cancelled_in_time")];
    renderPage();
    expect(within(card()).getAllByText("Cancelled by your supervisor").length).toBeGreaterThan(0);
    expect(within(card()).queryByText("Cancelled by you")).not.toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: /book it again/i })).not.toBeInTheDocument();
    expect(within(card()).getByText(/Your supervisor cancelled this booking/)).toBeInTheDocument();
  });

  it("hours that are already yours: the button stays, greyed, with the reason", () => {
    state.outcomes = [mine("cancelled_in_time")];
    state.clashes = new Map([["mon", "Rostered on the day shift on Mon 02/11, 06:00–18:00"]]);
    renderPage();
    expect(within(card()).getByText(/You can't book this again — rostered on the day shift/)).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: /book it again/i })).toBeDisabled();
  });

  it("blocked: the button is greyed (the banner says why)", () => {
    state.outcomes = [mine("cancelled_in_time")];
    state.block = { blocked_until: future(2), reason: "no_show", on_date: future(-1) };
    renderPage();
    expect(within(card()).getByRole("button", { name: /book it again/i })).toBeDisabled();
  });

  it("a closed ask: nothing to book again", () => {
    state.asks = [{ ...monday, status: "closed" }];
    state.outcomes = [mine("cancelled_in_time")];
    renderPage();
    expect(screen.queryByRole("button", { name: /book it again/i })).not.toBeInTheDocument();
  });
});
