/**
 * 29/10/2026: Rosana's yes landed on the reserve, she left the reserve nine seconds
 * later, and her card then had nothing to press — the old `leave_my_reserve` kept
 * `decision = 'reserve'` on her "no", and an answer can only change while there is no
 * decision. BLOCO 137 makes leaving a plain no. These are the card's side of it: what a
 * reserve place offers, what the card offers once it is left, and that a yes given again
 * is only ever called what the database wrote back.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
const fullAsk = {
  id: "fri-day", on_date: future(5), starts_at: "06:00:00", ends_at: "18:00:00", headcount: 2,
  department: "Production", shift_group: "Day", note: null, status: "open", created_by: "u",
  created_at: "", closed_at: null,
};

const state = vi.hoisted(() => ({
  responses: [] as unknown[],
  written: null as unknown,
  sent: [] as unknown[],
  left: [] as unknown[],
}));

vi.mock("@/hooks/useOvertimeRequests", () => ({
  useMyEmployee: () => ({
    data: { id: "e1", full_name: "Rosana Test", department: "Production", shift_group: "Day" },
    isPending: false, isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useMyUpcomingOvertime: () => ({ data: [fullAsk], isLoading: false }),
  useOvertimeResponses: () => ({ data: state.responses }),
  useMyOvertimeBlock: () => ({ data: null }),
  useMyOvertimeClashes: () => ({ data: new Map() }),
  useOvertimePlaces: () => ({ data: new Map([["fri-day", { taken: 2, headcount: 2 }]]) }),
  useOvertimeOutcomesFor: () => ({ data: [] }),
  useOvertimeMutations: () => ({
    cancelMyBooking: { mutate: vi.fn(), isPending: false },
    swapMyBooking: { mutate: vi.fn(), isPending: false },
    leaveReserve: {
      mutate: (v: unknown, o: { onSuccess?: () => void }) => { state.left.push(v); o.onSuccess?.(); },
      isPending: false,
    },
    answer: {
      mutate: (v: unknown, o: { onSuccess?: (row: unknown) => void; onSettled?: () => void }) => {
        state.sent.push(v);
        o.onSuccess?.(state.written);
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

const row = (answer: "yes" | "no", decision: string | null) => ({
  id: "r1", request_id: "fri-day", employee_id: "e1", answer, decision,
  answered_at: "2026-10-29T20:29:39Z", decided_at: decision ? "2026-10-29T20:29:39Z" : null,
});
const card = () => screen.getByText(/06:00–18:00/).closest("[id^='ask-']") as HTMLElement;

describe("leaving the reserve, then saying yes again", () => {
  beforeEach(() => {
    state.sent = []; state.left = []; state.written = null;
    toast.success.mockReset(); toast.error.mockReset();
  });

  it("a place on the reserve offers Leave the reserve list, not the answer buttons", () => {
    state.responses = [row("yes", "reserve")];
    renderPage();
    expect(within(card()).getByRole("button", { name: /leave the reserve list/i })).toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: /accept overtime|change to accept/i })).not.toBeInTheDocument();
  });

  it("leaving asks first, and the receipt promises nothing the database may not do yet", async () => {
    state.responses = [row("yes", "reserve")];
    renderPage();
    fireEvent.click(within(card()).getByRole("button", { name: /leave the reserve list/i }));
    expect(state.left).toEqual([]); // the dialog asks first
    fireEvent.click(screen.getByRole("button", { name: /yes, leave it/i }));
    await waitFor(() => expect(state.left).toEqual([{ requestId: "fri-day" }]));
    // Whether a yes can be given again is the card's to say, from the row it reads back.
    expect(toast.success).toHaveBeenLastCalledWith(expect.stringMatching(/^You left the reserve list/));
  });

  it("once left — a plain no, as BLOCO 137 writes it — the card offers Change to Accept", () => {
    state.responses = [row("no", null)];
    renderPage();
    expect(within(card()).getByText(/You declined this. Changed your mind\?/)).toBeInTheDocument();
    expect(within(card()).getByRole("button", { name: /change to accept/i })).toBeEnabled();
    expect(within(card()).queryByRole("button", { name: /leave the reserve list/i })).not.toBeInTheDocument();
  });

  it("a yes again on a full ask is told as the reserve list, never as booked", () => {
    state.responses = [row("no", null)];
    state.written = { answer: "yes", decision: "reserve" };
    renderPage();
    fireEvent.click(within(card()).getByRole("button", { name: /change to accept/i }));
    expect(state.sent).toEqual([{ requestId: "fri-day", answer: "yes" }]);
    const [title] = toast.success.mock.lastCall!;
    expect(title).toMatch(/^Answer changed to yes\. You're on the reserve list/);
    expect(title).not.toMatch(/booked/i);
  });

  it("booked only when the database says accepted", () => {
    state.responses = [row("no", null)];
    state.written = { answer: "yes", decision: "accepted" };
    renderPage();
    fireEvent.click(within(card()).getByRole("button", { name: /change to accept/i }));
    expect(toast.success).toHaveBeenLastCalledWith(expect.stringMatching(/^Answer changed to yes\. You're booked for/), expect.anything());
  });

  it("the state the old function left (no + reserve) says what happened, offers no button the database would refuse, and is not coloured as a place held", () => {
    state.responses = [row("no", "reserve")];
    renderPage();
    expect(within(card()).getByText(/You left the reserve list for this day/)).toBeInTheDocument();
    expect(within(card()).queryByRole("button", { name: /accept overtime|change to accept|leave the reserve list/i })).not.toBeInTheDocument();
    expect(within(card()).getAllByText("You said no").length).toBeGreaterThan(0);
    expect(card().querySelector("[class*='bg-warning']")).toBeNull();
  });
});
