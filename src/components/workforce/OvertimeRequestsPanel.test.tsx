import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";

/**
 * The overtime screen, split by the shift the overtime is for.
 *
 * Two asks on the same day: a day ask and a night ask. A day-crew packer has said yes
 * to the night one — cross-shift overtime, which must sit under Night. A second person
 * is already rostered on the night board, so accepting them would put the same shift
 * on them twice.
 */

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, role: "manager" }) }));
vi.mock("@/components/workforce/OvertimeRulesDialog", () => ({ OvertimeRulesDialog: () => null }));

const tomorrow = (() => {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

const requests = [
  { id: "day", on_date: tomorrow, starts_at: "06:00:00", ends_at: "18:00:00", headcount: 2, department: null,
    shift_group: null, note: null, status: "open", created_by: "u", created_at: "", closed_at: null },
  { id: "night", on_date: tomorrow, starts_at: "18:00:00", ends_at: "06:00:00", headcount: 2, department: null,
    shift_group: null, note: null, status: "open", created_by: "u", created_at: "", closed_at: null },
];
const responses = [
  { id: "r1", request_id: "night", employee_id: "e-day", answer: "yes", decision: "accepted", answered_at: "2026-10-12T10:00:00Z", decided_at: null },
  { id: "r2", request_id: "night", employee_id: "e-night", answer: "yes", decision: null, answered_at: "2026-10-12T10:05:00Z", decided_at: null },
  { id: "r3", request_id: "day", employee_id: "e-other", answer: "yes", decision: null, answered_at: "2026-10-12T10:06:00Z", decided_at: null },
];
const roster = [
  { id: "e-day", full_name: "Ana Day", department: "Packing", shift_group: "Day" },
  { id: "e-night", full_name: "Bruno Night", department: "Packing", shift_group: "Night" },
  { id: "e-other", full_name: "Carla", department: "Blending", shift_group: "Day" },
];
const board = [{ on_date: tomorrow, shift: "Night", employee_id: "e-night", status: "assigned" }];

const mutation = () => ({ mutate: vi.fn(), isPending: false });
vi.mock("@/hooks/useOvertimeRequests", () => ({
  useOvertimeRequests: () => ({ data: requests, isLoading: false, isError: false }),
  useOvertimeResponsesFor: () => ({ data: responses, isLoading: false }),
  useOvertimeOutcomesFor: () => ({ data: [] }),
  useOvertimeReliability: () => ({ data: new Map() }),
  useOvertimeRoster: () => ({ data: roster }),
  useOvertimeBoardRows: () => ({ data: board }),
  useOvertimeMutations: () => ({
    createRequest: mutation(), editRequest: mutation(), setRequestStatus: mutation(),
    decide: mutation(), recordOutcome: mutation(), answerFor: mutation(),
  }),
}));

import { OvertimeRequestsPanel } from "./OvertimeRequestsPanel";

describe("OvertimeRequestsPanel", () => {
  it("files each ask under the shift it is for, not the person's crew", () => {
    render(<OvertimeRequestsPanel />);
    expect(screen.getByRole("heading", { name: /Overtime Management/ })).toBeInTheDocument();

    const day = screen.getByRole("region", { name: /Day shift/ });
    const night = screen.getByRole("region", { name: /Night shift/ });
    expect(within(night).getByText("Ana Day")).toBeInTheDocument();   // day crew, night overtime
    expect(within(day).queryByText("Ana Day")).not.toBeInTheDocument();
    expect(within(day).getByText("Carla")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Day shift/ }), { button: 0 });
    expect(screen.queryByRole("region", { name: /Night shift/ })).not.toBeInTheDocument();
    expect(screen.getByText("Carla")).toBeInTheDocument();
    expect(screen.queryByText("Ana Day")).not.toBeInTheDocument();
  });

  it("counts match the rows: two awaiting, one confirmed, 12h scheduled", () => {
    render(<OvertimeRequestsPanel />);
    // The figure is the first of each label on the page; the rows reuse "Awaiting decision" as a badge.
    const fig = (label: string) => screen.getAllByText(label)[0].parentElement!;
    expect(fig("Awaiting decision")).toHaveTextContent("2");
    expect(fig("Confirmed")).toHaveTextContent("1");
    expect(fig("Scheduled overtime")).toHaveTextContent("12h");
  });

  it("will not accept somebody already rostered on that shift", () => {
    render(<OvertimeRequestsPanel />);
    const night = screen.getByRole("region", { name: /Night shift/ });
    expect(within(night).getByText(/Already rostered on the night shift/)).toBeInTheDocument();
    expect(within(night).getByRole("button", { name: "Accept Bruno Night" })).toBeDisabled();
    expect(within(night).getByRole("button", { name: "Reserve Bruno Night" })).toBeEnabled();
  });
});
