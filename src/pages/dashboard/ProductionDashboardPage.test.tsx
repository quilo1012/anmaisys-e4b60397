/**
 * The Production dashboard: the board's own figures, each section behind the action of
 * the screen it comes from, and every card opening the records it counted.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/operationalShift", () => ({
  currentShift: () => ({ operationalDate: "2026-10-14", shift: "Day" }),
}));

const state = vi.hoisted(() => ({
  role: "admin" as string,
  allocError: null as Error | null,
  calls: { allocations: 0, overtime: 0, report: 0 },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role, user: { id: "u" } }) }));

const areas = [
  { id: "l1", name: "Line 1", kind: "production", section: "", department: null, sort_order: 1, active: true },
  { id: "wh", name: "Warehouse", kind: "support", section: "", department: null, sort_order: 2, active: true },
];
const alloc = (employee_id: string, status: string, area_id: string | null = null) =>
  ({ id: employee_id, on_date: "2026-10-14", shift: "Day", employee_id, area_id, status });

vi.mock("@/hooks/useHeadcount", () => ({
  useHeadcountAreas: () => ({ data: areas, isLoading: false }),
  useShiftRoster: (shift: string) => ({
    data: shift === "Day" ? ["a", "b", "c", "d", "e"].map((id) => ({ id })) : [{ id: "n1" }],
    boardById: new Map(["a", "b", "c", "d", "e", "f", "n1"].map((id) => [id, { id }])),
    isLoading: false,
  }),
  useAllocations: (_d: string, shift: string) => {
    state.calls.allocations += 1;
    return {
      data: shift === "Day" ? [alloc("a", "assigned", "l1"), alloc("b", "assigned", "wh"), alloc("c", "sick"), alloc("f", "overtime", "l1")] : [alloc("n1", "assigned", "l1")],
      isLoading: false,
      error: state.allocError,
    };
  },
  useBoardTrend: () => ({ data: { rows: [], drawableOn: () => true }, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useOvertimeRequests", () => ({
  useOvertimeRequestsBetween: () => {
    state.calls.overtime += 1;
    return { data: [], isLoading: false, error: null, refetch: vi.fn() };
  },
  useOvertimeResponsesFor: () => ({ data: [], isLoading: false, error: null }),
  useOvertimeOutcomesFor: () => ({ data: [] }),
}));
vi.mock("@/hooks/useReportSummary", () => ({
  useReportSummary: () => {
    state.calls.report += 1;
    return { data: { production: { plan: 1000, actual: 900, efficiencyPct: 90, days: 5 } }, isLoading: false, error: null, refetch: vi.fn() };
  },
}));
vi.mock("@/hooks/useStoppedLinesCount", () => ({ useStoppedLinesCount: () => ({ data: 0 }) }));

import ProductionDashboardPage from "@/pages/dashboard/ProductionDashboardPage";

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dashboard/departments/production"]}>
        <Routes>
          <Route path="/dashboard/departments/production" element={<ProductionDashboardPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.role = "admin";
  state.allocError = null;
  state.calls = { allocations: 0, overtime: 0, report: 0 };
});

describe("Production dashboard", () => {
  it("adds the board up by the board's rules, both shifts", () => {
    renderPage();
    const staffing = screen.getByRole("region", { name: /Staffing/ });
    // Day: a, b working; f on overtime on Line 1; c sick; d, e due in with no row.
    // Night: n1 working. Overtime on a line is in production, as on the board.
    const fig = (label: string) => within(staffing).getAllByText(label)[0].closest("div")!.parentElement!;
    expect(fig("Due in")).toHaveTextContent("6");
    expect(fig("In production")).toHaveTextContent("4");
    expect(fig("In production")).toHaveTextContent("3 on lines · 1 support");
    expect(fig("Away")).toHaveTextContent("1 sick");
    expect(fig("Not placed")).toHaveTextContent("2");
  });

  it("opens the board on the day it counted", () => {
    renderPage();
    fireEvent.click(within(screen.getByRole("region", { name: /Staffing/ })).getByText("Not placed"));
    expect(screen.getByTestId("where")).toHaveTextContent("/dashboard/headcount?date=2026-10-14&shift=Split");
  });

  it("names what needs attention, with a link to it", () => {
    renderPage();
    const attention = screen.getByRole("region", { name: "Needs attention" });
    expect(within(attention).getByText("Day: 2 due in and not placed")).toBeInTheDocument();
    expect(within(attention).getByText("Day: 1 off sick or unpaid")).toBeInTheDocument();
    expect(within(attention).getByText("Every overtime ask in the next 7 days has somebody booked.")).toBeInTheDocument();
  });

  it("shows output against plan from RAG Weekly", () => {
    renderPage();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("900 of 1,000 planned")).toBeInTheDocument();
  });

  it("does not read the board for a role that cannot open it", () => {
    state.role = "manager"; // overtime.manage and rag.view, not headcount.view
    renderPage();
    expect(screen.getByText(/Staffing is not shown/)).toBeInTheDocument();
    expect(state.calls.allocations).toBe(0);
    expect(state.calls.overtime).toBeGreaterThan(0);
    const shortcuts = screen.getByRole("navigation", { name: "Quick actions" });
    expect(within(shortcuts).queryByRole("link", { name: "Board" })).not.toBeInTheDocument();
    expect(within(shortcuts).getByRole("link", { name: "Overtime" })).toHaveAttribute("href", "/dashboard/overtime");
  });

  it("reads nothing it may not show", () => {
    state.role = "employee";
    renderPage();
    expect(state.calls).toEqual({ allocations: 0, overtime: 0, report: 0 });
    expect(screen.getByText(/Overtime is not shown/)).toBeInTheDocument();
  });

  it("says a failed read failed, instead of drawing zeros", () => {
    state.allocError = new Error("network");
    renderPage();
    expect(within(screen.getByRole("region", { name: /Staffing/ })).getByRole("alert"))
      .toHaveTextContent(/not zero — they are missing/);
  });
});
