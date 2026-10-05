/**
 * The sentence three screens read the clock through.
 *
 * The arithmetic is tested in src/hooks/useClockCoverage.test.ts. What has to hold
 * here is the wording, because the wording is the whole feature: a clock six days
 * ahead of today was being described with the word "today", and a reader who believes
 * that reads every empty figure below as an empty factory.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClockCoverageNote } from "@/components/workforce/ClockCoverageNote";
import type { ClockCoverage } from "@/hooks/useClockCoverage";

const state = {
  coverage: null as ClockCoverage | null,
  isLoading: false,
  isError: false,
};

vi.mock("@/hooks/useClockCoverage", () => ({
  useClockCoverage: () => state,
  CLOCK_STALE_DAYS: 7,
}));

const coverage = (p: Partial<ClockCoverage>): ClockCoverage => ({
  lastOnDate: "2026-10-05",
  firstOnDate: "2026-06-01",
  employeesCovered: 99,
  activeEmployees: 211,
  rowsTotal: 5000,
  daysBehind: 0,
  daysAhead: null,
  stale: false,
  ...p,
});

beforeEach(() => {
  state.coverage = null;
  state.isLoading = false;
  state.isError = false;
});

describe("ClockCoverageNote", () => {
  it("never calls a clock six days ahead of today \"today\"", () => {
    // The live state on 05/10/2026.
    state.coverage = coverage({ lastOnDate: "2026-10-11", daysBehind: -6, daysAhead: 6 });
    const { container } = render(<ClockCoverageNote todayIso="2026-10-05" />);
    const said = container.textContent ?? "";

    expect(said).toContain("11 Oct 2026");
    expect(said).toContain("6 days from now");
    // The gap slot is where the word used to appear, and it is the only place it
    // would be read as a measurement. The explanation below may still say "today".
    expect(said).not.toMatch(/—\s*today|\(today\)/);
    expect(said).not.toContain("days ago");
    expect(screen.getByText(/cannot have been worked yet/)).toBeInTheDocument();
  });

  it("says it in the compact line too, which is where two of the three screens read it", () => {
    state.coverage = coverage({ lastOnDate: "2026-10-11", daysBehind: -6, daysAhead: 6 });
    render(<ClockCoverageNote todayIso="2026-10-05" compact />);

    expect(screen.getByText(/carries days up to/)).toBeInTheDocument();
    expect(screen.getByText(/6 days from now/)).toBeInTheDocument();
  });

  it("still reports a clock that is behind, the way it always did", () => {
    state.coverage = coverage({ lastOnDate: "2026-09-06", daysBehind: 26, stale: true });
    render(<ClockCoverageNote todayIso="2026-10-02" />);

    expect(screen.getByText(/26 days ago/)).toBeInTheDocument();
    expect(screen.getByText(/not yet imported/)).toBeInTheDocument();
  });

  it("says today only when the clock really is on today", () => {
    state.coverage = coverage({ lastOnDate: "2026-10-05", daysBehind: 0 });
    render(<ClockCoverageNote todayIso="2026-10-05" />);

    expect(screen.getByText(/today/)).toBeInTheDocument();
  });

  it("stays quiet about dates when the date could not be read", () => {
    state.coverage = coverage({ lastOnDate: "not-a-date", daysBehind: null, daysAhead: null });
    render(<ClockCoverageNote todayIso="2026-10-05" />);

    expect(screen.queryByText(/today/)).not.toBeInTheDocument();
    expect(screen.queryByText(/days ago/)).not.toBeInTheDocument();
  });

  it("tells an empty table apart from a quiet factory", () => {
    state.coverage = coverage({ lastOnDate: null, daysBehind: null });
    render(<ClockCoverageNote todayIso="2026-10-05" />);

    expect(screen.getByText(/Nothing has ever been imported/)).toBeInTheDocument();
  });

  it("does not let a failed read look like a clock that is up to date", () => {
    state.isError = true;
    render(<ClockCoverageNote todayIso="2026-10-05" />);

    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
  });

  it("shows nothing at all while it is loading", () => {
    state.isLoading = true;
    const { container } = render(<ClockCoverageNote todayIso="2026-10-05" />);

    expect(container).toBeEmptyDOMElement();
  });
});
