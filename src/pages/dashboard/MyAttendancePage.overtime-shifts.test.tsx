/**
 * "Overtime for October 2026: 0 h" on 30/10/2026, for somebody who had worked two
 * weekend overtime shifts. The figure read the clock alone, and his clock record stopped
 * at 20/10. It now counts the shifts the supervisor marked attended on days the clock has
 * no hours for, and says which part came from where.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { MyAttendanceData, MyOvertimeShiftRecord } from "@/lib/myAttendance";

vi.mock("@/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const env = vi.hoisted(() => ({
  attendance: vi.fn(),
  shifts: vi.fn(),
  marks: null as unknown,
  print: vi.fn(async () => {}),
  sheetThrows: false,
}));
vi.mock("@/components/workforce/PayslipDraftSheet", () => ({
  printPayslipDrafts: env.print,
  PayslipDraftSheet: ({ draft }: { draft: { header: { name: string } } }) => {
    if (env.sheetThrows) throw new Error("sheet broke");
    return <article data-testid="payslip-draft">{draft.header.name}</article>;
  },
}));
vi.mock("@/hooks/useMyAttendance", () => ({ useMyAttendance: env.attendance }));
vi.mock("@/hooks/useMyOvertimeShifts", () => ({ useMyOvertimeShifts: env.shifts }));
// my_board_marks not pasted: the asks keep their own hours.
vi.mock("@/hooks/useMyBoardMarks", () => ({ useMyBoardMarks: () => ({ data: env.marks }) }));
vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => false }));
vi.mock("@/lib/operationalShift", () => ({ currentShift: () => ({ operationalDate: "2026-10-30" }) }));

import MyAttendancePage from "@/pages/dashboard/MyAttendancePage";

const PERIOD = { id: "p", name: "October 2026", start_date: "2026-10-12", end_date: "2026-11-08" };
const clock = (on_date: string) => ({
  on_date, start_time: "6:00", end_time: "18:00", worked_minutes: 720, balance_minutes: 0,
  scheduled_minutes: 720, overtime_adj_minutes: 0, absence_name: null,
});
const DATA: MyAttendanceData = {
  me: { id: "e-003", full_name: "Ailton Junior", employee_ref: "E003", department: "Production", position: "Team Leader", shift_group: "Day", started_on: null },
  pattern: { name: "Tue–Fri days", days: [2, 3, 4, 5], starts_at: "06:00:00", ends_at: "18:00:00", break_minutes: 0, annual_leave_days: 22.5 },
  clocks: ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-20"].map(clock),
  clocked_to: "2026-10-20", clocks_imported_at: "2026-10-22T18:56:00Z",
  marks: [], holiday_marks: [], requests: [], payroll: [], periods: [PERIOD],
  board: [
    { on_date: "2026-10-30", shift: "Day", status: "assigned", half_day: false, area: "Line 6", area_kind: "production", is_leader: true },
    { on_date: "2026-10-31", shift: "Day", status: "overtime", half_day: false, area: "Line 2", area_kind: "production", is_leader: false },
  ],
  overtime: [],
};
const SHIFTS: MyOvertimeShiftRecord[] = [
  { on_date: "2026-10-24", starts_at: "06:00:00", ends_at: "18:00:00", outcome: "attended" },
  { on_date: "2026-10-25", starts_at: "06:00:00", ends_at: "14:00:00", outcome: "attended" },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><MyAttendancePage /></MemoryRouter></QueryClientProvider>);
}

describe("overtime shifts beside the clock's figure", () => {
  afterEach(() => { vi.useRealTimers(); });
  beforeEach(() => {
    // The screen was taken on 30/10; the board's 31/10 overtime is still ahead then.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T17:11:00"));
    env.attendance.mockReset().mockReturnValue({ data: { state: "ready", data: DATA }, isPending: false, isError: false });
    env.shifts.mockReset();
    env.marks = null;
    env.sheetThrows = false;
  });

  it("07/11: 20/10 and 21/10 booked 06:00–14:00 on rows the office placed read as the board's 12 h each", () => {
    vi.setSystemTime(new Date("2026-11-07T09:49:00"));
    const placed = {
      ...DATA, clocks: [], clocked_to: null,
      board: ["2026-10-20", "2026-10-21"].map((on_date) => ({ on_date, shift: "Day", status: "overtime", half_day: false, area: "Line 2", area_kind: "production", is_leader: false })),
    };
    env.attendance.mockReturnValue({ data: { state: "ready", data: placed }, isPending: false, isError: false });
    env.shifts.mockReturnValue({ data: [
      { request_id: "q20", on_date: "2026-10-20", starts_at: "06:00:00", ends_at: "14:00:00", outcome: null },
      { request_id: "q21", on_date: "2026-10-21", starts_at: "06:00:00", ends_at: "14:00:00", outcome: null },
    ] });
    env.marks = ["2026-10-20", "2026-10-21"].map((on_date) => ({ on_date, shift: "Day", left_early_at: null, arrived_late_at: null, overtime_request_id: null }));
    renderPage();
    const box = screen.getByTestId("overtime-shifts");
    expect(box).toHaveTextContent(/Overtime shifts worked\s*24 h/);
    expect(box).not.toHaveTextContent(/06:00–14:00/);
    expect(box.textContent?.match(/06:00–18:00/g)).toHaveLength(2);
  });

  it("counts the two attended shifts in October's overtime: 20 h, not 0 h", () => {
    env.shifts.mockReturnValue({ data: SHIFTS });
    renderPage();
    expect(env.shifts).toHaveBeenCalledWith("e-003", "2026-10-12", "2026-11-08");
    const hours = screen.getByTestId("hours-balance");
    expect(hours).toHaveTextContent(/Overtime for October 2026\s*20 h/);
    expect(hours).toHaveTextContent(/0 h on the clock \+ 20 h from 2 overtime shifts you worked on days the clock has no hours for yet/);
    expect(hours).toHaveTextContent(/the office's close counts these hours once the clock is imported/);
  });

  it("does not count a shift twice once the clock has the day", () => {
    const withClock = { ...DATA, clocks: [...DATA.clocks, { ...DATA.clocks[0], on_date: "2026-10-24", balance_minutes: 720, scheduled_minutes: 0 }] };
    env.attendance.mockReturnValue({ data: { state: "ready", data: withClock }, isPending: false, isError: false });
    env.shifts.mockReturnValue({ data: SHIFTS });
    renderPage();
    // 12 h from the clock (24/10) + 8 h attended (25/10, not on the clock).
    expect(screen.getByTestId("hours-balance")).toHaveTextContent(/Overtime for October 2026\s*20 h/);
    expect(screen.getByTestId("hours-balance")).toHaveTextContent(/12 h on the clock \+ 8 h from 1 overtime shift/);
  });

  it("shows the supervisor's record: 20 h over two shifts, and the Headcount booking ahead", () => {
    env.shifts.mockReturnValue({ data: SHIFTS });
    renderPage();
    const box = screen.getByTestId("overtime-shifts");
    expect(box).toHaveTextContent(/Overtime shifts worked\s*20 h/);
    expect(box).toHaveTextContent("06:00–18:00");
    expect(box).toHaveTextContent("06:00–14:00");
    expect(box).toHaveTextContent(/Booked ahead.*06:00–18:00.*on the Headcount/);
  });

  it("adds nothing when there is no overtime to speak of", () => {
    env.attendance.mockReturnValue({ data: { state: "ready", data: { ...DATA, board: [] } }, isPending: false, isError: false });
    env.shifts.mockReturnValue({ data: [] });
    renderPage();
    expect(screen.queryByTestId("overtime-shifts")).not.toBeInTheDocument();
    expect(screen.getByTestId("hours-balance")).toHaveTextContent(/Overtime for October 2026\s*0 h/);
    expect(screen.getByTestId("hours-balance")).toHaveTextContent(/as the finance close counts it/);
  });

  it("adds nothing while the shifts are loading", () => {
    env.shifts.mockReturnValue({ data: undefined });
    renderPage();
    expect(screen.queryByTestId("overtime-shifts")).not.toBeInTheDocument();
  });

  it("opens my own payslip draft on screen, without printing: an iPhone app ignores print", async () => {
    // 10/11/2026: employees tapped "Payslip draft" on the home-screen app and nothing
    // opened — the button only ever asked the browser to print.
    env.shifts.mockReturnValue({ data: SHIFTS });
    env.print.mockClear();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Payslip draft/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("payslip-draft")).toHaveTextContent("Ailton Junior");
    expect(env.print).not.toHaveBeenCalled();
  });

  it("prints that draft from the page: hours only, the phone's overtime", async () => {
    env.shifts.mockReturnValue({ data: SHIFTS });
    env.print.mockClear();
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Payslip draft/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /^Print$/ }));
    await waitFor(() => expect(env.print).toHaveBeenCalledTimes(1));
    const [[drafts, title]] = env.print.mock.calls as unknown as [[{ header: { name: string }; overtime: { periodHours: number | null } }[], string]];
    expect(title).toBe("Payslip draft · October 2026");
    expect(drafts[0].header.name).toBe("Ailton Junior");
    // The same 20 h the card above says.
    expect(drafts[0].overtime.periodHours).toBe(20);
  });
  // 11/11/2026: "the employee still cannot open the payslip draft" after it moved on screen.
  // Each of these left the button missing, grey for good, or the page blank.
  it("still offers the draft when the range is not a pay period, for the period it sits in", async () => {
    // No period runs today, so the page opens on this month — and the button was hidden.
    const SEPT = { id: "s", name: "September 2026", start_date: "2026-09-14", end_date: "2026-10-11" };
    env.attendance.mockReturnValue({ data: { state: "ready", data: { ...DATA, periods: [SEPT] } }, isPending: false, isError: false });
    env.shifts.mockReturnValue({ data: SHIFTS });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Payslip draft/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Payslip draft · September 2026/)).toBeInTheDocument();
    expect(within(dialog).getByTestId("payslip-draft")).toHaveTextContent("Ailton Junior");
  });

  it("opens the draft when the booked overtime could not be read, instead of a grey button for good", async () => {
    env.shifts.mockReturnValue({ data: undefined, isError: true });
    renderPage();
    const button = screen.getByRole("button", { name: /Payslip draft/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("payslip-draft")).toBeInTheDocument();
    expect(within(dialog).getByText(/overtime shifts could not be loaded/i)).toBeInTheDocument();
  });

  it("waits for the overtime still loading, then opens", async () => {
    env.shifts.mockReturnValue({ data: undefined });
    const view = renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Payslip draft/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Opening/ })).toBeInTheDocument();
    env.shifts.mockReturnValue({ data: SHIFTS });
    const client = new QueryClient();
    view.rerender(<QueryClientProvider client={client}><MemoryRouter><MyAttendancePage /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("says the sheet could not be shown instead of blanking the page", async () => {
    env.shifts.mockReturnValue({ data: SHIFTS });
    env.sheetThrows = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Payslip draft/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/could not be shown/);
    expect(screen.getByText("Hours and overtime")).toBeInTheDocument();
  });
});
