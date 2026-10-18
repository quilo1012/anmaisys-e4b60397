/**
 * The screen a supervisor uses: search a problem, pick a period, read the hours and
 * open orders, drill into the orders behind them. The arithmetic is tested in
 * src/lib/maintenanceProblemAnalysis.test.ts; here it is what reaches the page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { startOfDay, subDays } from "date-fns";
import { buildRows, type AnalysisWorkOrder } from "@/lib/maintenanceProblemAnalysis";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/useRole", () => ({ useRole: () => ({ can: () => true }) }));

const hook = vi.fn();
vi.mock("@/hooks/useMaintenanceProblemAnalysis", () => ({
  useMaintenanceProblemAnalysis: (range: unknown) => hook(range),
}));

import MaintenanceProblemAnalysisPage from "@/pages/dashboard/MaintenanceProblemAnalysisPage";

const base = (id: string, n: number, over: Partial<AnalysisWorkOrder>): AnalysisWorkOrder => ({
  id, wo_number: n, description: "Sealing jaw jammed", machine: "Line 4", status: "closed",
  created_at: "2026-10-10T08:00:00Z", started_at: "2026-10-10T08:00:00Z",
  finished_at: "2026-10-10T09:00:00Z", closed_at: null, engineer_name: "Eng A", ...over,
});

const rows = buildRows(
  [
    base("w1", 101, {}),
    base("w2", 102, { status: "in_progress", finished_at: null }),
    base("w3", 103, { description: "Label printer offline", machine: "Line 5A" }),
    base("w4", 104, { status: "open", started_at: null, finished_at: null }),
  ],
  [
    { id: "w1", active_repair_sec: 2 * 3600, line_downtime_sec: 3 * 3600 },
    { id: "w3", active_repair_sec: 1800, line_downtime_sec: null },
  ],
);
const activeRows = buildRows(
  [base("w2", 102, { status: "in_progress" }), base("w4", 104, { status: "open" }), base("old", 50, { status: "open", created_at: "2026-06-01T08:00:00Z" })],
  [],
);

const kpi = (label: string) => screen.getByTestId(`kpi-${label}`).textContent;

beforeEach(() => {
  hook.mockReset();
  hook.mockReturnValue({ rows, activeRows, isLoading: false, error: null, refetch: vi.fn() });
});

const renderPage = () => render(<MemoryRouter><MaintenanceProblemAnalysisPage /></MemoryRouter>);

describe("MaintenanceProblemAnalysisPage", () => {
  it("opens on the last 30 days", () => {
    renderPage();
    const { from } = hook.mock.calls[0][0] as { from: Date };
    expect(from.getTime()).toBe(startOfDay(subDays(new Date(), 29)).getTime());
  });

  it("shows totals for every order in the period", () => {
    renderPage();
    expect(kpi("Total orders")).toBe("4");
    expect(kpi("Total maintenance hours")).toBe("2.5 h");
    expect(kpi("Open orders")).toBe("2");
    expect(kpi("Closed orders")).toBe("2");
    expect(kpi("Average hours / order")).toBe("1.3 h"); // 2.5 h over the 2 timed orders
    expect(kpi("Line downtime")).toBe("3.0 h");
  });

  it("search narrows every figure, and the open-now count includes older orders", () => {
    renderPage();
    fireEvent.change(screen.getByLabelText("Search by problem"), { target: { value: "jaw" } });
    expect(kpi("Total orders")).toBe("3");
    expect(kpi("Total maintenance hours")).toBe("2.0 h");
    expect(kpi("Open orders")).toBe("2");
    expect(screen.getByText(/3 open now, any date/)).toBeInTheDocument();
    expect(screen.queryByText("Label printer offline")).not.toBeInTheDocument();
  });

  it("drills into the orders behind a problem, each linking to its work order", () => {
    renderPage();
    fireEvent.click(screen.getByText("Label printer offline"));
    const link = screen.getByRole("link", { name: /Open WO-2026-000103/ });
    expect(link).toHaveAttribute("href", "/dashboard/wo/w3");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("a quick filter changes the range asked for, and Reset goes back to 30 days", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
    const last = hook.mock.calls.at(-1)![0] as { from: Date };
    expect(last.from.getTime()).toBe(startOfDay(subDays(new Date(), 6)).getTime());
    fireEvent.change(screen.getByLabelText("Search by problem"), { target: { value: "zzz" } });
    expect(screen.getByText("No maintenance orders match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reset filters/ }));
    const reset = hook.mock.calls.at(-1)![0] as { from: Date };
    expect(reset.from.getTime()).toBe(startOfDay(subDays(new Date(), 29)).getTime());
    expect((screen.getByLabelText("Search by problem") as HTMLInputElement).value).toBe("");
  });

  it("says so when the orders cannot be loaded", () => {
    hook.mockReturnValue({ rows: [], activeRows: [], isLoading: false, error: new Error("permission denied"), refetch: vi.fn() });
    renderPage();
    expect(screen.getByText("Could not load maintenance orders")).toBeInTheDocument();
    expect(within(document.body).getByText("permission denied")).toBeInTheDocument();
  });
});
