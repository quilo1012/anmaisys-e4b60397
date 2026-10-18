/**
 * The Maintenance dashboard: open orders now, work in a period, and every card
 * opening the orders list on what it counted.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { buildRows } from "@/lib/maintenanceProblemAnalysis";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const wo = (id: string, o: Record<string, unknown>) => ({
  id, wo_number: Number(id.replace(/\D/g, "")) || 1, description: "Belt slipping", machine: "Filler 1",
  status: "open", created_at: hoursAgo(5), started_at: null, finished_at: null, closed_at: null,
  engineer_name: null, line_at_time: "Line 1", wo_type: "production", ...o,
});

const state = vi.hoisted(() => ({
  role: "maintenance_manager" as string,
  error: null as Error | null,
  pm: [] as unknown[],
  active: [] as unknown[],
  period: [] as unknown[],
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role, user: { id: "u" } }) }));
vi.mock("@/hooks/useMaintenanceProblemAnalysis", () => ({
  useMaintenanceProblemAnalysis: () => ({
    rows: state.period, activeRows: state.active, isLoading: false, error: state.error, refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/useMaintenanceKpis", () => ({ useMaintenanceKpis: () => ({ avgMTTRMin: 42, isLoading: false }) }));
vi.mock("@/hooks/usePreventiveMaintenance", async (orig) => ({
  ...(await orig<typeof import("@/hooks/usePreventiveMaintenance")>()),
  usePmSchedules: () => ({ data: state.pm, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useStoppedLinesCount", () => ({ useStoppedLinesCount: () => ({ data: 1 }) }));
vi.mock("@/hooks/useDepartmentDashboards", () => ({ useWoFinishedCount: () => ({ data: 3, isLoading: false }) }));

import MaintenanceDashboardPage from "@/pages/dashboard/MaintenanceDashboardPage";

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/dashboard/departments/maintenance"]}>
        <Routes>
          <Route path="/dashboard/departments/maintenance" element={<MaintenanceDashboardPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.role = "maintenance_manager";
  state.error = null;
  state.pm = [];
  state.active = buildRows([
    wo("w1", { status: "open", priority: "critical" }),
    wo("w2", { status: "received", priority: "high", engineer_name: "Ana" }),
    wo("w3", { status: "in_progress", priority: "medium", engineer_name: "Ana", started_at: hoursAgo(80) }),
    wo("w4", { status: "in_progress", priority: "low", engineer_name: "Rui", started_at: hoursAgo(2) }),
  ] as never, []);
  state.period = buildRows([
    // Hours count only on an order with both clocks — Problem Analysis's rule.
    wo("p1", { status: "closed", description: "Belt slipping", started_at: hoursAgo(4), finished_at: hoursAgo(3) }),
    wo("p2", { status: "closed", description: "Belt slipping", wo_type: "preventive", started_at: hoursAgo(4), finished_at: hoursAgo(3) }),
    wo("p3", { status: "open", description: "Sensor fault", line_at_time: "Line 2" }),
  ] as never, [
    { id: "p1", active_repair_sec: 3600, line_downtime_sec: 1800 },
    { id: "p2", active_repair_sec: 1800, line_downtime_sec: null },
  ]);
});

const fig = (region: HTMLElement, label: string) => within(region).getAllByText(label)[0].closest("div")!.parentElement!;

describe("Maintenance dashboard", () => {
  it("counts open orders by the list's own buckets and rules", () => {
    renderPage();
    const now = screen.getByRole("region", { name: "Now" });
    expect(fig(now, "Not finished")).toHaveTextContent("4");
    expect(fig(now, "Not accepted")).toHaveTextContent("1");
    expect(fig(now, "In progress")).toHaveTextContent("2");
    expect(fig(now, "Over 72 hours")).toHaveTextContent("1");
  });

  it("opens the orders list on what each card counted, not on today", () => {
    renderPage();
    fireEvent.click(within(screen.getByRole("region", { name: "Now" })).getByText("Over 72 hours"));
    expect(screen.getByTestId("where")).toHaveTextContent("/dashboard/work-orders?status=stale&range=all");
  });

  it("adds up the period: raised, corrective against preventive, hours", () => {
    renderPage();
    const period = screen.getByRole("region", { name: /Period/ });
    expect(fig(period, "Raised")).toHaveTextContent("3");
    expect(fig(period, "Raised")).toHaveTextContent("2 corrective · 1 preventive");
    expect(fig(period, "Repair hours")).toHaveTextContent("1.5 h");
    expect(within(period).getAllByText("Belt slipping").length).toBeGreaterThan(0);
    expect(within(period).queryByText(/No repair hours recorded/)).not.toBeInTheDocument();
  });

  it("puts a stopped line and a critical order at the top of what needs attention", () => {
    renderPage();
    const items = within(screen.getByText("Needs attention").closest("div")!.parentElement!.parentElement!).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/stopped/);
    expect(items[1]).toHaveTextContent("1 critical order not finished");
  });

  it("says when no preventive schedule exists, rather than 'nothing due'", () => {
    renderPage();
    expect(screen.getByText(/No preventive schedules are set up yet/)).toBeInTheDocument();
  });

  it("hides preventive figures from a role without the preventive screen", () => {
    state.role = "warehouse"; // wo.view, not pm.view — and not this dashboard by default
    renderPage();
    expect(screen.queryByText("Preventive due")).not.toBeInTheDocument();
    expect(screen.queryByText(/preventive maintenance coming due/i)).not.toBeInTheDocument();
  });

  it("reads nothing for a role that cannot see orders", () => {
    state.role = "employee";
    renderPage();
    expect(screen.getByText(/Maintenance orders is not shown/)).toBeInTheDocument();
    expect(screen.queryByText("Not finished")).not.toBeInTheDocument();
  });

  it("says a failed read failed", () => {
    state.error = new Error("network");
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent(/not zero — they are missing/);
  });
});
