/**
 * The "OVERTIME AVAILABLE" alert: who it rings for, what it says, and that only the
 * server's answer closes it.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const future = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ask = (id: string, over: Record<string, unknown> = {}) => ({
  id, on_date: future(3), starts_at: "06:00:00", ends_at: "18:00:00", headcount: null, department: null,
  shift_group: null, note: null, status: "open", created_by: "boss", created_at: "", closed_at: null, ...over,
});

type Callbacks = { onSuccess?: (row: unknown) => void; onError?: (e: unknown) => void; onSettled?: () => void };
const state = vi.hoisted(() => ({
  me: { id: "e1", full_name: "Ana Day", department: "Production", shift_group: "Day" } as unknown,
  requests: [] as unknown[],
  responses: [] as unknown[],
  places: undefined as Map<string, { taken: number; headcount: number | null }> | undefined,
  block: null as unknown,
  tablet: false,
  calls: [] as { vars: { requestId: string; answer: string }; cb: Callbacks }[],
  refetch: (() => {}) as () => void,
}));

vi.mock("@/lib/sharedTabletSession", () => ({ isSharedTabletSession: () => state.tablet }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useOvertimeRequests", () => ({
  useMyEmployee: () => ({ data: state.me }),
  useMyUpcomingOvertime: () => ({ data: state.requests, isSuccess: true, refetch: state.refetch }),
  useOvertimeResponses: () => ({ data: state.responses, isSuccess: true, refetch: vi.fn() }),
  useMyOvertimeClashes: () => ({ data: new Map(), isPending: false }),
  useMyOvertimeBlock: () => ({ data: state.block }),
  useOvertimePlaces: () => ({ data: state.places }),
  useOvertimeOutcomesFor: () => ({ data: [] }),
  useOvertimeMutations: () => ({
    answer: {
      isPending: false,
      mutate: (vars: { requestId: string; answer: string }, cb: Callbacks) => { state.calls.push({ vars, cb }); },
    },
  }),
}));

import { OvertimeOfferAlert } from "@/components/workforce/OvertimeOfferAlert";

const renderAlert = () => render(<MemoryRouter><OvertimeOfferAlert /></MemoryRouter>);
const settle = (i: number, how: { row?: unknown; error?: string }) => act(() => {
  const { cb } = state.calls[i];
  if (how.error) cb.onError?.(new Error(how.error)); else cb.onSuccess?.(how.row);
  cb.onSettled?.();
});

beforeEach(() => {
  localStorage.clear();
  state.me = { id: "e1", full_name: "Ana Day", department: "Production", shift_group: "Day" };
  state.requests = [ask("a1", { note: "Line 3 changeover" })];
  state.responses = [];
  state.places = undefined;
  state.block = null;
  state.tablet = false;
  state.calls = [];
  state.refetch = vi.fn();
});

describe("Overtime offer alert", () => {
  it("1. a valid, unanswered ask rings with the real date, hours, duration and area", () => {
    renderAlert();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("OVERTIME AVAILABLE")).toBeInTheDocument();
    expect(screen.getByText("06:00–18:00")).toBeInTheDocument();
    expect(screen.getByText("(12h)")).toBeInTheDocument();
    expect(screen.getByText("Everyone")).toBeInTheDocument();
    expect(screen.getByText(/Line 3 changeover/)).toBeInTheDocument();
    const year = future(3).slice(0, 4);
    expect(screen.getByText(new RegExp(year))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /accept overtime/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /decline/i })).toBeEnabled();
    // No deadline or pay is invented: the ask carries neither.
    expect(screen.queryByText(/deadline|respond by|£|pay/i)).toBeNull();
  });

  it("2. an ask already answered — yes or no — does not ring", () => {
    state.requests = [ask("y"), ask("n")];
    state.responses = [
      { request_id: "y", employee_id: "e1", answer: "yes", decision: "accepted" },
      { request_id: "n", employee_id: "e1", answer: "no", decision: null },
    ];
    renderAlert();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("3. a cancelled, closed or started ask does not ring", () => {
    state.requests = [
      ask("c", { status: "cancelled" }), ask("x", { status: "closed" }),
      ask("s", { on_date: future(-1) }),
    ];
    renderAlert();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("3b. cancelled while on screen: the alert says so and saves nothing", () => {
    const { rerender } = renderAlert();
    state.requests = [ask("a1", { status: "cancelled" })];
    rerender(<MemoryRouter><OvertimeOfferAlert /></MemoryRouter>);
    expect(screen.getByText("This overtime is no longer available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept overtime/i })).toBeNull();
    expect(state.calls).toHaveLength(0);
  });

  it("4. no places left: says a yes goes to reserve, and reports reserve from the server", () => {
    state.requests = [ask("a1", { headcount: 2 })];
    state.places = new Map([["a1", { taken: 2, headcount: 2 }]]);
    renderAlert();
    expect(screen.getByText(/a yes puts you on the reserve list/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /accept overtime/i }));
    settle(0, { row: { answer: "yes", decision: "reserve" } });
    expect(screen.getByText("You're on the reserve list")).toBeInTheDocument();
  });

  it("5. a server or network error keeps the ask on screen, says so, and allows a retry", () => {
    renderAlert();
    fireEvent.click(screen.getByRole("button", { name: /accept overtime/i }));
    settle(0, { error: "Failed to fetch" });
    expect(screen.getByRole("alert")).toHaveTextContent(/not saved/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/Failed to fetch/);
    expect(state.refetch).toHaveBeenCalled();
    const accept = screen.getByRole("button", { name: /accept overtime/i });
    expect(accept).toBeEnabled();
    fireEvent.click(accept);
    expect(state.calls).toHaveLength(2);
  });

  it("6. a double tap on accept sends one answer, and the buttons wait", () => {
    renderAlert();
    const accept = screen.getByRole("button", { name: /accept overtime/i });
    fireEvent.click(accept);
    fireEvent.click(accept);
    expect(state.calls).toHaveLength(1);
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /decline/i })).toBeDisabled();
    // Escape does not close it mid-flight either.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("7. not for me: another department, no linked employee, or a shared tablet", () => {
    state.requests = [ask("d", { department: "Warehouse" })];
    const a = renderAlert();
    expect(screen.queryByRole("dialog")).toBeNull();
    a.unmount();

    state.requests = [ask("a1")];
    state.me = null;
    const b = renderAlert();
    expect(screen.queryByRole("dialog")).toBeNull();
    b.unmount();

    state.me = { id: "e1", full_name: "Ana Day", department: "Production", shift_group: "Day" };
    state.tablet = true;
    renderAlert();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("7b. blocked from signing up: accept is off, decline still works", () => {
    state.block = { blocked_until: "2026-11-01", on_date: "2026-10-10", reason: "no_show" };
    renderAlert();
    expect(screen.getByRole("button", { name: /accept overtime/i })).toBeDisabled();
    expect(screen.getByText(/can't sign up until 01\/11/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(state.calls[0].vars).toEqual({ requestId: "a1", answer: "no" });
  });

  it("9. closes only after the server confirms, and then does not ring again", () => {
    const { rerender } = renderAlert();
    fireEvent.click(screen.getByRole("button", { name: /accept overtime/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    settle(0, { row: { answer: "yes", decision: "accepted" } });
    expect(screen.getByText("You're booked")).toBeInTheDocument();
    // The refresh brings the answer back.
    state.responses = [{ request_id: "a1", employee_id: "e1", answer: "yes", decision: "accepted" }];
    rerender(<MemoryRouter><OvertimeOfferAlert /></MemoryRouter>);
    expect(screen.getByText("You're booked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("10. 'Not now' is not an answer: nothing is sent, and the same ask does not ring again", () => {
    const first = renderAlert();
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(state.calls).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();
    renderAlert();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("10b. one alert at a time, with the rest counted", () => {
    state.requests = [ask("a1"), ask("a2", { on_date: future(4) }), ask("a3", { on_date: future(5) })];
    renderAlert();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("+ 2 more waiting for your answer")).toBeInTheDocument();
  });
});
