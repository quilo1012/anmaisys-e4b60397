/**
 * The floor could read "2 people needed" but never how many were still free: their
 * read policy shows them only their own answer. `overtime_places()` (BLOCO 101) gives
 * them the counts, never the names.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/SignupQrCard", () => ({ SignupQrCard: () => null }));
vi.mock("@/components/workforce/OvertimePushNudge", () => ({ OvertimePushNudge: () => null }));
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => false }));

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const ask = (id: string, starts_at: string, ends_at: string) => ({
  id, on_date: future(5), starts_at, ends_at, headcount: 2, department: null, shift_group: null,
  note: null, status: "open", created_by: "u", created_at: "", closed_at: null,
});

const state = vi.hoisted(() => ({
  responses: [] as unknown[],
  clashes: new Map<string, string>(),
  places: undefined as Map<string, { taken: number; headcount: number }> | undefined,
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
    answer: { mutate: vi.fn(), isPending: false },
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

describe("room left on an ask", () => {
  it("says how many places are left, and what a yes means once it is full", () => {
    state.responses = [];
    state.places = new Map([
      ["sat-day", { taken: 1, headcount: 2 }],
      ["sat-night", { taken: 2, headcount: 2 }],
    ]);
    renderPage();
    expect(screen.getByText("1 of 2 places left")).toBeInTheDocument();
    expect(screen.getByText(/All 2 places are filled — a yes puts you on the reserve list/)).toBeInTheDocument();
    // Full is not a closed door: the reserve is who steps in when somebody drops out.
    expect(screen.getAllByRole("button", { name: /yes, i can/i }).every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("is not said to somebody the supervisor has already picked", () => {
    state.responses = [{
      id: "r1", request_id: "sat-day", employee_id: "e1", answer: "yes", decision: "accepted",
      answered_at: "2026-10-12T10:00:00Z", decided_at: "2026-10-12T11:00:00Z",
    }];
    state.places = new Map([["sat-day", { taken: 2, headcount: 2 }]]);
    renderPage();
    expect(screen.queryByText(/places are filled/)).not.toBeInTheDocument();
  });

  it("says nothing about room before the block is pasted", () => {
    state.responses = [];
    state.places = undefined;
    renderPage();
    expect(screen.queryByText(/places? (left|are filled)/)).not.toBeInTheDocument();
    expect(screen.getAllByText("2 people needed — Everyone")).toHaveLength(2);
  });
});
