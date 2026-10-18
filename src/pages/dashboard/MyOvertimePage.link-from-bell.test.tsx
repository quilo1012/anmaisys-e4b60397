/**
 * Arriving from the bell: `/dashboard/my-overtime?ask=<id>` rings that ask, and says so
 * plainly when it is no longer in the list instead of leaving the person to hunt for it.
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
  useMyUpcomingOvertime: () => ({
    data: [ask("sat-day", "06:00:00", "18:00:00"), ask("sat-night", "18:00:00", "06:00:00")],
    isLoading: false,
  }),
  useOvertimeResponses: () => ({ data: state.responses }),
  useMyOvertimeBlock: () => ({ data: null }),
  useMyOvertimeClashes: () => ({ data: state.clashes }),
  useOvertimePlaces: () => ({ data: undefined }),
  useOvertimeMutations: () => ({
    answer: { mutate: vi.fn(), isPending: false },
    linkMe: { mutate: vi.fn(), isPending: false },
    linkMeByEmail: { mutate: vi.fn(), isPending: false },
  }),
}));

import MyOvertimePage from "@/pages/dashboard/MyOvertimePage";

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}><MyOvertimePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("a link from a notification", () => {
  it("rings the ask it names", () => {
    state.responses = [];
    state.clashes = new Map();
    const { container } = renderAt("/dashboard/my-overtime?ask=sat-night");
    expect(container.querySelector("#ask-sat-night")?.className).toMatch(/ring-2/);
    expect(container.querySelector("#ask-sat-day")?.className).not.toMatch(/ring-2/);
    expect(screen.queryByText("That overtime is no longer available")).not.toBeInTheDocument();
  });

  it("says the ask is gone when it is not in the list", () => {
    state.responses = [];
    state.clashes = new Map();
    renderAt("/dashboard/my-overtime?ask=cancelled-one");
    expect(screen.getByText("That overtime is no longer available")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /yes, i can/i })).toHaveLength(2);
  });

  it("says so too when it was on the person's own hours and the list is empty", () => {
    state.responses = [];
    state.clashes = new Map([["sat-day", "rota"], ["sat-night", "rota"]]);
    renderAt("/dashboard/my-overtime?ask=sat-day");
    expect(screen.getByText("That overtime is no longer available")).toBeInTheDocument();
  });

  it("says nothing without a link", () => {
    state.responses = [];
    state.clashes = new Map();
    renderAt("/dashboard/my-overtime");
    expect(screen.queryByText("That overtime is no longer available")).not.toBeInTheDocument();
  });
});
