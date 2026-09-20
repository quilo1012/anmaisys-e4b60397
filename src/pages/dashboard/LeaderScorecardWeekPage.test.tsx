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

/**
 * `useUnledShifts` reads `production_sessions` directly rather than through an RPC, so
 * the client needs `from` here too. Without it the hook threw, react-query swallowed it,
 * and the notice simply never rendered — tests that passed while proving nothing.
 */
let unledRows: { line: string | null }[] = [];
let unledError: Error | null = null;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a stand-in for the query builder
      const builder: any = {};
      for (const method of ["select", "is", "gte", "lte", "eq"]) builder[method] = () => builder;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thenable, like the real builder
      builder.then = (resolve: any) => resolve({ data: unledRows, error: unledError });
      return builder;
    },
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
  unledRows = [];
  unledError = null;
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

    expect(await screen.findByText(/no line was opened in this week/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Zero is a real count here, not a stand-in for "unknown" — the query
    // succeeded, so the footer is trustworthy.
    expect(screen.getByText(/0 to fill/i)).toBeInTheDocument();
  });

  it("says how much of the week the board is not showing", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    unledRows = [
      { line: "Line 4" },
      { line: "Line 1" },
      { line: "Line 4" },
      { line: "Tablet Line" },
    ];
    renderPage();

    expect(await screen.findByText(/4 shifts this week have no leader recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/Line 1, Line 4, Tablet Line/)).toBeInTheDocument();
    // A gap is not a failure: the destructive block and its alert role stay reserved
    // for a query that broke.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("counts a single unled shift in the singular", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    unledRows = [{ line: "Line 2" }];
    renderPage();

    expect(await screen.findByText(/1 shift this week has no leader recorded/i)).toBeInTheDocument();
  });

  it("stays quiet on a week where every shift had a leader", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    unledRows = [];
    renderPage();

    // Wait for the board to settle so this is not just an assertion made too early.
    expect(await screen.findByText(/no line was opened in this week/i)).toBeInTheDocument();
    expect(screen.queryByText(/no leader recorded/i)).not.toBeInTheDocument();
  });

  it("does not report a gap when the board query itself failed", async () => {
    // "20 shifts have no leader" next to "the week could not load" reads as a
    // measurement of a week nobody managed to measure.
    rpc.mockResolvedValue({ data: null, error: new Error("boom") });
    unledRows = [{ line: "Line 5" }, { line: "Line 5" }];
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load the week/i);
    expect(screen.queryByText(/no leader recorded/i)).not.toBeInTheDocument();
  });
});
