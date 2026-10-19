/**
 * "Which badge is yours?" is asked when the database says this login is nobody — and
 * only then.
 *
 * The screen read `isLoading` and fell through to the badge prompt for every other
 * state. Two of those states are not "unlinked":
 *
 * - the lookup has not started yet. React Query 5 reports a disabled query (the auth
 *   user still resolving) as pending but NOT loading, so the prompt flashed up before
 *   anybody had been asked who this is;
 * - the lookup failed. On an iPhone a slow network ends in "Fetch is aborted" after
 *   15 s, and the page then asked a linked person to register their badge again.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/SignupQrCard", () => ({ SignupQrCard: () => null }));
vi.mock("@/components/workforce/OvertimePushNudge", () => ({ OvertimePushNudge: () => null }));
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => false }));

const me = vi.hoisted(() => ({ state: vi.fn() }));

vi.mock("@/hooks/useOvertimeRequests", () => ({
  useMyEmployee: me.state,
  useMyUpcomingOvertime: () => ({ data: [], isLoading: false }),
  useOvertimeResponses: () => ({ data: [] }),
  useMyOvertimeBlock: () => ({ data: null }),
  useMyOvertimeClashes: () => ({ data: undefined }),
  useOvertimePlaces: () => ({ data: undefined }),
  useOvertimeOutcomesFor: () => ({ data: [] }),
  useOvertimeMutations: () => ({
    answer: { mutate: vi.fn() },
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

const prompt = () => screen.queryByText(/Which badge is yours/i);

describe("the badge prompt", () => {
  beforeEach(() => me.state.mockReset());

  it("is not shown before the lookup has even started", () => {
    // What React Query 5 returns for a query that is disabled until the user resolves.
    me.state.mockReturnValue({ data: undefined, isPending: true, isLoading: false, isError: false, refetch: vi.fn() });
    renderPage();
    expect(prompt()).not.toBeInTheDocument();
  });

  it("is not shown when the lookup failed, and offers to try again", () => {
    const refetch = vi.fn();
    me.state.mockReturnValue({ data: undefined, isPending: false, isLoading: false, isError: true, refetch });
    renderPage();
    expect(prompt()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("is not shown to a linked person", () => {
    me.state.mockReturnValue({
      data: { id: "e-21", full_name: "Daniel Quilo", department: "Office", shift_group: null },
      isPending: false, isLoading: false, isError: false, refetch: vi.fn(),
    });
    renderPage();
    expect(prompt()).not.toBeInTheDocument();
  });

  it("is shown when the database answered that this login is nobody", () => {
    me.state.mockReturnValue({ data: null, isPending: false, isLoading: false, isError: false, refetch: vi.fn() });
    renderPage();
    expect(prompt()).toBeInTheDocument();
  });
});
