/**
 * What the employee sees while the list loads, when it fails, when it is empty, and
 * when a thumb taps "Yes" twice before the screen has caught up.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/SignupQrCard", () => ({ SignupQrCard: () => null }));
vi.mock("@/components/workforce/OvertimePushNudge", () => ({ OvertimePushNudge: () => null }));
vi.mock("@/components/workforce/OvertimeAuditLog", () => ({ OvertimeAuditLog: () => null }));
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => false }));

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const ask = (id: string, days: number) => ({
  id, on_date: future(days), starts_at: "06:00:00", ends_at: "18:00:00", headcount: 2, department: null,
  shift_group: null, note: null, status: "open", created_by: "u", created_at: "", closed_at: null,
});

const state = vi.hoisted(() => ({
  upcoming: { data: [] as unknown[], isLoading: false, isError: false, refetch: () => {} } as Record<string, unknown>,
  mutate: (() => {}) as (...a: unknown[]) => void,
}));

vi.mock("@/hooks/useOvertimeRequests", () => ({
  useMyEmployee: () => ({
    data: { id: "e1", full_name: "Ana Day", department: "Production", shift_group: "Day" },
    isPending: false, isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useMyUpcomingOvertime: () => state.upcoming,
  useOvertimeResponses: () => ({ data: [] }),
  useMyOvertimeBlock: () => ({ data: null }),
  useMyOvertimeClashes: () => ({ data: new Map() }),
  useOvertimePlaces: () => ({ data: undefined }),
  useOvertimeOutcomesFor: () => ({ data: [] }),
  useOvertimeMutations: () => ({
    cancelMyBooking: { mutate: vi.fn(), isPending: false },
    swapMyBooking: { mutate: vi.fn(), isPending: false },
    leaveReserve: { mutate: vi.fn(), isPending: false },
    answer: { mutate: state.mutate, isPending: false },
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

beforeEach(() => {
  state.upcoming = { data: [], isLoading: false, isError: false, refetch: vi.fn() };
  state.mutate = vi.fn();
});

describe("My Overtime — states", () => {
  it("loading shows the shape of the cards, not a word", () => {
    state.upcoming = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    renderPage();
    expect(screen.getByRole("status", { name: /loading your overtime/i })).toBeInTheDocument();
  });

  it("a failed load says so and offers a retry, instead of claiming there is nothing", () => {
    const refetch = vi.fn();
    state.upcoming = { data: undefined, isLoading: false, isError: true, refetch };
    renderPage();
    expect(screen.queryByText(/no upcoming overtime/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("an empty list says what to expect", () => {
    renderPage();
    expect(screen.getByText(/No upcoming overtime, Ana/)).toBeInTheDocument();
    expect(screen.getByText(/shows up here/)).toBeInTheDocument();
  });

  it("says how many asks are waiting for an answer", () => {
    state.upcoming = { data: [ask("a", 3), ask("b", 4)], isLoading: false, isError: false, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText("2 waiting for your answer")).toBeInTheDocument();
  });

  it("a double tap on Yes sends one answer", () => {
    state.upcoming = { data: [ask("a", 3)], isLoading: false, isError: false, refetch: vi.fn() };
    renderPage();
    const yes = screen.getByRole("button", { name: /yes, i can/i });
    fireEvent.click(yes);
    fireEvent.click(yes);
    expect(state.mutate).toHaveBeenCalledTimes(1);
  });
});
