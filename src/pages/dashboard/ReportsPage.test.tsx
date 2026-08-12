import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The three things a period report can be, and the two it used to confuse.
 *
 * The page read `data!` — a promise to the compiler that the summary is there — on a
 * query that placeheld a report of zeros. That gave it exactly one state to render,
 * and the query has three:
 *
 * - Still reading. The placeholder put the query in `success` on the first render, so
 *   a screen of zeros and dashes was shown as the period itself, under a footnote
 *   promising a dash meant nothing was recorded. It meant nothing had arrived yet.
 * - Failed. On error the placeholder does not apply, `data` is undefined, and `data!`
 *   is a lie: reading `.production` off it threw and took the whole screen down.
 * - Answered. The only one it was written for.
 *
 * These tests fix the page to the three, and the middle one is the white screen.
 */

vi.mock("@/components/BackButton", () => ({ BackButton: () => null }));

const summary = vi.fn();
vi.mock("@/hooks/useReportSummary", () => ({ useReportSummary: () => summary() }));

import ReportsPage from "./ReportsPage";

const ANSWER = {
  production: { plan: 1000, actual: 900, efficiencyPct: 90, days: 5 },
  downtime: { minutes: 45, stops: 2, worstLine: "Line 1", worstMinutes: 45 },
  maintenance: { raised: 3, closed: 2, avgResponseMin: 10, avgRepairMin: 30 },
  quality: { total: 4, open: 1, critical: 0 },
};

const state = (over: Record<string, unknown>) => ({
  data: undefined, isPending: false, isError: false, error: null,
  isFetching: false, refetch: vi.fn(), ...over,
});

const show = () => render(<MemoryRouter><ReportsPage /></MemoryRouter>);

beforeEach(() => summary.mockReset());

describe("ReportsPage", () => {
  it("says the read failed instead of taking the screen down", () => {
    summary.mockReturnValue(state({
      isError: true,
      error: new Error("v_wo_downtime_total: permission denied"),
    }));

    // The assertion is that this renders at all: `data!` threw here.
    expect(() => show()).not.toThrow();
    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.getByText(/v_wo_downtime_total/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("does not claim a quiet period while it is still reading", () => {
    summary.mockReturnValue(state({ isPending: true }));
    show();

    expect(screen.getByLabelText(/loading the period/i)).toBeInTheDocument();
    // No figures, and above all no footnote explaining what the dashes mean.
    expect(screen.queryByText(/Efficiency/)).not.toBeInTheDocument();
    expect(screen.queryByText(/A dash means nothing was recorded/)).not.toBeInTheDocument();
  });

  it("prints nothing until there is a period to print", () => {
    summary.mockReturnValue(state({ isPending: true }));
    expect(screen.queryByRole("button", { name: /print/i })).toBeNull();
    show();
    expect(screen.getByRole("button", { name: /print/i })).toBeDisabled();
  });

  it("leads each section with the figure that section answers", () => {
    summary.mockReturnValue(state({ data: ANSWER }));
    show();

    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("900 of 1,000")).toBeInTheDocument();
    // Twice over: the period's total, and again as the worst line's share of it —
    // which on a single-stoppage period is the same 45 minutes said two ways.
    expect(screen.getAllByText("45m").length).toBe(2);
    expect(screen.getByText("across 2 stoppages")).toBeInTheDocument();
    expect(screen.getByText("of 4 raised")).toBeInTheDocument();
    expect(screen.getByText(/A dash means nothing was recorded/)).toBeInTheDocument();
  });
});
