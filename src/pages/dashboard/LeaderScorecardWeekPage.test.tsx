/**
 * The week board's failure and empty states, rendered.
 *
 * `boardCounts`/`weekEndingFor`/`scoreCell` are already tested on their own in
 * src/__tests__/scorecardWeek.test.ts, and `ScorecardWeekBoard`'s row rendering is
 * its own component's concern. What only this page decides is the branch between
 * "the query failed" and "there is genuinely nothing to show" — the RPC does not
 * exist in the database yet, so a person opening this screen today must see the
 * error, not a board quietly reporting nobody is assigned.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

// The layout drags in the sidebar, realtime subscriptions and auth. None of that is
// what these tests are about.
vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import LeaderScorecardWeekPage from "@/pages/dashboard/LeaderScorecardWeekPage";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <LeaderScorecardWeekPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  rpc.mockReset();
});

describe("LeaderScorecardWeekPage", () => {
  it("tells the user the query failed, rather than showing an empty board", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("relation \"scorecard_week_board\" does not exist") });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load the week/i);
    expect(screen.getByText(/scorecard_week_board.*does not exist/i)).toBeInTheDocument();
    // The genuinely-empty copy must not appear alongside a failure — the two facts
    // are different and this screen must not blur them.
    expect(screen.queryByText(/no leader is assigned/i)).not.toBeInTheDocument();
    // Nor the outstanding-work counts: they would read as "0 to fill" when the
    // truth is "unknown, the query failed".
    expect(screen.queryByText(/to fill/i)).not.toBeInTheDocument();
  });

  it("shows the dashed empty state when the week genuinely has no rows", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    renderPage();

    expect(await screen.findByText(/no leader is assigned to a line for this week/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Zero is a real count here, not a stand-in for "unknown" — the query
    // succeeded, so the footer is trustworthy.
    expect(screen.getByText(/0 to fill/i)).toBeInTheDocument();
  });
});
