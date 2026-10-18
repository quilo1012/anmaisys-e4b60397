/**
 * The weekend crew was offered Saturday 06:00–18:00 overtime on top of their own
 * Saturday 06:00–18:00. The page now hides what `my_overtime_clashes()` names, and
 * keeps — without a yes — an ask the person had already answered.
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
}));

vi.mock("@/hooks/useOvertimeRequests", () => ({
  useMyEmployee: () => ({
    data: { id: "e1", full_name: "Ana Weekend", department: "Production", shift_group: "Weekend" },
    isPending: false, isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useOvertimeRequests: () => ({
    data: [ask("sat-day", "06:00:00", "18:00:00"), ask("sat-night", "18:00:00", "06:00:00")],
    isLoading: false,
  }),
  useOvertimeResponses: () => ({ data: state.responses }),
  useMyOvertimeBlock: () => ({ data: null }),
  useMyOvertimeClashes: () => ({ data: state.clashes }),
  useOvertimeMutations: () => ({
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

describe("overtime on the person's own hours", () => {
  it("is not offered; overtime outside them still is", () => {
    state.responses = [];
    state.clashes = new Map([["sat-day", "Your rota has you on the day shift on Sat, 06:00–18:00"]]);
    renderPage();
    expect(screen.queryByText(/06:00–18:00/)).not.toBeInTheDocument();
    expect(screen.getByText(/18:00–06:00/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /yes, i can/i })).toHaveLength(1);
  });

  it("an ask already answered stays, says why, and offers only no", () => {
    state.responses = [{
      id: "r1", request_id: "sat-day", employee_id: "e1", answer: "no", decision: null,
      answered_at: "2026-10-12T10:00:00Z", decided_at: null,
    }];
    state.clashes = new Map([["sat-day", "Your rota has you on the day shift on Sat, 06:00–18:00"]]);
    renderPage();
    expect(screen.getByText(/These hours are already yours — your rota has you/)).toBeInTheDocument();
    const yes = screen.getAllByRole("button", { name: /yes, i can/i });
    expect(yes).toHaveLength(2);
    expect(yes.filter((b) => (b as HTMLButtonElement).disabled)).toHaveLength(1);
  });

  it("before the block is pasted (no clashes known) everything is offered as before", () => {
    state.responses = [];
    state.clashes = new Map();
    renderPage();
    expect(screen.getAllByRole("button", { name: /yes, i can/i })).toHaveLength(2);
  });
});
