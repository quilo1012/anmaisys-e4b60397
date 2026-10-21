/**
 * Where I'm working: its own page (not a card inside My Attendance), one person's shifts and
 * work area from the Headcount Board, with the states a page about a person must not confuse.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { MyAttendanceData } from "@/lib/myAttendance";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const env = vi.hoisted(() => ({
  result: vi.fn(),
  shared: vi.fn(() => false),
}));
vi.mock("@/hooks/useMyAttendance", () => ({ useMyAttendance: env.result }));
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: env.shared }));
vi.mock("@/lib/operationalShift", () => ({ currentShift: () => ({ operationalDate: "2026-10-20" }) }));

import MyWorkAreaPage from "@/pages/dashboard/MyWorkAreaPage";

const DATA = {
  me: { id: "e-1", full_name: "Ana Silva", employee_ref: "E045", department: "Production", position: null, shift_group: "Day", started_on: null },
  pattern: null, clocks: [], clocked_to: null, clocks_imported_at: null,
  marks: [], holiday_marks: [], requests: [], payroll: [], periods: [],
  board: [{ on_date: "2026-10-20", shift: "Day", status: "assigned", half_day: null, area: "Gel Line", area_kind: "production", is_leader: false }],
} as unknown as MyAttendanceData;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><MyWorkAreaPage /></MemoryRouter></QueryClientProvider>);
}

describe("Where I'm working", () => {
  beforeEach(() => { env.result.mockReset(); env.shared.mockReturnValue(false); });

  it("asks only for the next two weeks and shows the board's column", () => {
    env.result.mockReturnValue({ data: { state: "ready", data: DATA }, isPending: false, isError: false });
    renderPage();
    expect(env.result).toHaveBeenCalledWith("2026-10-20", "2026-11-02");
    const card = screen.getByTestId("where-im-working");
    expect(card).toHaveTextContent("Gel Line");
    expect(card.querySelector('[data-shift="day"]')).toHaveTextContent("Day shift");
  });

  it("admits when nobody placed the person", () => {
    env.result.mockReturnValue({ data: { state: "ready", data: { ...DATA, board: [{ ...DATA.board[0], area: null }] } }, isPending: false, isError: false });
    renderPage();
    expect(screen.getByTestId("where-im-working")).toHaveTextContent("Work area not yet assigned");
  });

  it("says so on a shared tablet and when the badge is not linked", () => {
    env.shared.mockReturnValue(true);
    env.result.mockReturnValue({ data: undefined, isPending: false, isError: false });
    const { unmount } = renderPage();
    expect(screen.getByText(/signed in for the line/i)).toBeInTheDocument();
    unmount(); env.shared.mockReturnValue(false);
    env.result.mockReturnValue({ data: { state: "unlinked" }, isPending: false, isError: false });
    renderPage();
    expect(screen.getByText(/not linked to your badge/i)).toBeInTheDocument();
  });
});
