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

  it("keeps an accepted person Expected, without asking for everybody to be marked Present", () => {
    state.asks = [askOn(day(-1), [person({})])];
    render(<OvertimeAttendancePanel date={day(-1)} shift="Day" />);
    expect(screen.getAllByText("Expected")[0]).toBeInTheDocument();
    expect(screen.getByText("Accepted 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Expected 1")).toBeInTheDocument();
    expect(screen.queryByText(/no attendance recorded yet/)).not.toBeInTheDocument();
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
    expect(toast.success).toHaveBeenLastCalledWith("Ana marked Absent — Overtime No-Show.", expect.anything());
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

  describe("mark overtime absent by name", () => {
    const twoAsks = (): AskAttendance[] => [
      askOn(day(-1), [person({}), person({ responseId: "r2", employeeId: "e2", name: "Bruno" })]),
      {
        request: { id: "q2", on_date: day(-1), starts_at: "14:00:00", ends_at: "18:00:00", headcount: 2, status: "open", note: null },
        rows: [
          person({ responseId: "r3" }),
          person({ responseId: "r4", employeeId: "e3", name: "Carla", response: "declined" }),
          person({ responseId: "r5", employeeId: "e4", name: "Dario", response: "reserve" }),
        ],
      },
    ];
    const find = (v: string) => fireEvent.change(screen.getByLabelText(/Mark overtime absent/), { target: { value: v } });

    it("narrows to the person and records the absence on that booking only", () => {
      state.asks = twoAsks();
      render(<OvertimeAttendancePanel date={day(-1)} shift="Day" />);
      find("bru");
      expect(screen.queryByText("Ana")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Absent — Bruno" }));
      expect(state.sent).toEqual([{ responseId: "r2", outcome: "no_show", note: undefined }]);
    });

    it("with two bookings on the day, shows both and asks for the one they missed", () => {
      state.asks = twoAsks();
      render(<OvertimeAttendancePanel date={day(-1)} shift="Day" />);
      find("ana");
      expect(screen.getByText("Ana has 2 overtime bookings on this board. Mark the one they missed.")).toBeInTheDocument();
      const buttons = screen.getAllByRole("button", { name: "Absent — Ana" });
      expect(buttons).toHaveLength(2);
      fireEvent.click(buttons[1]);
      expect(state.sent).toEqual([{ responseId: "r3", outcome: "no_show", note: undefined }]);
    });

    it("refuses somebody who declined or is only on reserve, and offers no Absent", () => {
      state.asks = twoAsks();
      render(<OvertimeAttendancePanel date={day(-1)} shift="Day" />);
      find("carla");
      expect(screen.getByText("Carla did not accept overtime on this board, so an overtime no-show cannot be recorded.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Absent/ })).not.toBeInTheDocument();
      find("dario");
      expect(screen.getByText(/Dario did not accept overtime/)).toBeInTheDocument();
    });

    it("says so when nobody by that name answered", () => {
      state.asks = twoAsks();
      render(<OvertimeAttendancePanel date={day(-1)} shift="Day" />);
      find("zed");
      expect(screen.getByText("Nobody called “zed” answered overtime on this board.")).toBeInTheDocument();
    });

    it("keeps the ask's counts whole while the list is narrowed", () => {
      state.asks = twoAsks();
      render(<OvertimeAttendancePanel date={day(-1)} shift="Day" />);
      find("bru");
      expect(screen.getByText("Accepted 2 of 3")).toBeInTheDocument();
    });
  });
});
