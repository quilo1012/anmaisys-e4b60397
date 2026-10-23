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

/**
 * 23/10: an employee on a Tue–Thu Day rota cancelled her Monday 06:00–18:00 overtime and
 * the page kept listing it as "Overtime · Work area not yet assigned". These are the two
 * payloads `my_attendance` returned for her on the development database: before the fix
 * the cancelled ask still came back in `overtime`, after it does not. The page only draws
 * what it is given, so the fix is the payload; this pins what each one looks like.
 */
describe("Where I'm working after an overtime is cancelled", () => {
  beforeEach(() => { env.result.mockReset(); env.shared.mockReturnValue(false); });

  const tuesday = { on_date: "2026-10-27", shift: "Day", status: "assigned", half_day: false, area: "Gel Packing", area_kind: "production", is_leader: false };
  const cancelledDay = {
    ...DATA,
    me: { ...DATA.me, full_name: "Dev Rosana", employee_ref: "D129" },
    pattern: { name: "Tue–Thu days", days: [2, 3, 4], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 60, annual_leave_days: 17 },
    board: [tuesday],
  } as unknown as MyAttendanceData;
  const rows = () => Array.from(screen.getByTestId("where-im-working").querySelectorAll("li")).map((li) => li.textContent ?? "");

  it("before the fix: the cancelled Monday came back as unplaced overtime", () => {
    const before = { ...cancelledDay, overtime: [{ on_date: "2026-10-26", starts_at: "06:00:00", ends_at: "18:00:00" }] } as unknown as MyAttendanceData;
    env.result.mockReturnValue({ data: { state: "ready", data: before }, isPending: false, isError: false });
    renderPage();
    const monday = rows().filter((t) => t.includes("Overtime"));
    expect(monday).toHaveLength(1);
    expect(monday[0]).toMatch(/06:00–18:00/);
    expect(monday[0]).toMatch(/Work area not yet assigned/);
  });

  it("after the fix: no overtime row, and her rota and placed Tuesday are still there", () => {
    const after = { ...cancelledDay, overtime: [] } as unknown as MyAttendanceData;
    env.result.mockReturnValue({ data: { state: "ready", data: after }, isPending: false, isError: false });
    renderPage();
    const all = rows();
    expect(all.some((t) => t.includes("Overtime"))).toBe(false);
    expect(all.some((t) => t.includes("Gel Packing") && t.includes("06:00–18:00"))).toBe(true);
    // Tue 20/10 is today here; Wed–Thu of both weeks are rota days the board has not placed.
    expect(all.filter((t) => t.includes("Work area not yet assigned"))).toHaveLength(5);
  });
});
