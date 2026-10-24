import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { AskAttendance } from "@/hooks/useOvertimeAttendance";

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const state = vi.hoisted(() => ({
  manages: true,
  asks: [] as unknown[],
  sent: [] as unknown[],
}));
vi.mock("@/hooks/useRole", () => ({ useRole: () => ({ can: () => state.manages }) }));
vi.mock("@/hooks/useOvertimeAttendance", () => ({
  useOvertimeAttendance: (_d: string, _s: string, enabled: boolean) => ({ data: enabled ? state.asks : [], isError: false }),
}));
vi.mock("@/hooks/useOvertimeRequests", () => ({
  useOvertimeMutations: () => ({
    recordOutcome: {
      isPending: false,
      mutate: (v: unknown, o: { onSuccess?: (r: { promotedEmployeeId: null }) => void }) => {
        state.sent.push(v); o.onSuccess?.({ promotedEmployeeId: null });
      },
    },
  }),
}));

import { OvertimeAttendancePanel } from "@/components/workforce/OvertimeAttendancePanel";

const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const person = (o: Partial<AskAttendance["rows"][number]>) => ({
  responseId: "r1", employeeId: "e1", name: "Ana", response: "accepted" as const, attendance: "not_checked" as const,
  note: null, recordedAt: null, recordedBy: null, corrected: false, ...o,
});
const askOn = (on_date: string, rows: AskAttendance["rows"]): AskAttendance => ({
  request: { id: "q1", on_date, starts_at: "06:00:00", ends_at: "14:00:00", headcount: 3, status: "open", note: null },
  rows,
});

describe("overtime attendance on the Headcount Board", () => {
  beforeEach(() => { state.manages = true; state.sent = []; toast.success.mockReset(); });

  it("shows nothing to somebody who does not manage overtime", () => {
    state.manages = false;
    state.asks = [askOn(day(-1), [person({})])];
    const { container } = render(<OvertimeAttendancePanel date={day(-1)} shift="Day" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps an accepted person Not yet checked and flags it once the shift has started", () => {
    state.asks = [askOn(day(-1), [person({})])];
    render(<OvertimeAttendancePanel date={day(-1)} shift="Day" />);
    expect(screen.getAllByText("Not yet checked")[0]).toBeInTheDocument();
    expect(screen.getByText("Accepted 1 of 3")).toBeInTheDocument();
    expect(screen.getByText(/1 accepted overtime with no attendance recorded yet/)).toBeInTheDocument();
  });

  it("records Present, and Absent with a note, through the audited RPC", () => {
    state.asks = [askOn(day(-1), [person({})])];
    render(<OvertimeAttendancePanel date={day(-1)} shift="Day" />);
    fireEvent.click(screen.getByRole("button", { name: "Present — Ana" }));
    fireEvent.change(screen.getByLabelText("Note — Ana"), { target: { value: "Phoned at 06:20, car broke down" } });
    fireEvent.click(screen.getByRole("button", { name: "Absent — Ana" }));
    expect(state.sent).toEqual([
      { responseId: "r1", outcome: "attended", note: undefined },
      { responseId: "r1", outcome: "no_show", note: "Phoned at 06:20, car broke down" },
    ]);
    expect(toast.success).toHaveBeenLastCalledWith("Ana marked absent.", expect.anything());
  });

  it("does not let Present or Absent be marked before the overtime starts", () => {
    state.asks = [askOn(day(3), [person({})])];
    render(<OvertimeAttendancePanel date={day(3)} shift="Day" />);
    expect(screen.getByRole("button", { name: "Present — Ana" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Absent — Ana" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Called sick — Ana" })).toBeEnabled();
    expect(screen.queryByText(/no attendance recorded yet/)).not.toBeInTheDocument();
  });

  it("shows who recorded it, when, the note, and that it was corrected", () => {
    state.asks = [askOn(day(-1), [person({
      attendance: "present", recordedAt: "2026-10-24T06:15:00Z", recordedBy: "Sam Supervisor", note: "Arrived 06:15", corrected: true,
    })])];
    render(<OvertimeAttendancePanel date={day(-1)} shift="Day" />);
    expect(screen.getByText(/by Sam Supervisor — “Arrived 06:15”/)).toBeInTheDocument();
    expect(screen.getByText("corrected")).toBeInTheDocument();
    expect(screen.getByText("Present 1")).toBeInTheDocument();
  });

  it("lists declines apart and never counts them, and greys a cancelled booking", () => {
    state.asks = [askOn(day(-1), [
      person({ responseId: "r2", name: "Bo", response: "declined" }),
      person({ responseId: "r3", name: "Cy", attendance: "cancelled" }),
    ])];
    render(<OvertimeAttendancePanel date={day(-1)} shift="Day" />);
    expect(screen.getByText("Declined (not counted): Bo")).toBeInTheDocument();
    expect(screen.getByText("Booking cancelled")).toBeInTheDocument();
    expect(screen.getByText("Accepted 0 of 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Present — Cy" })).not.toBeInTheDocument();
  });
});
