import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SmartTargetView } from "./SmartTargetBlock";
import type { SmartLineTarget } from "@/hooks/useSmartLineTarget";

const target = (over: Partial<SmartLineTarget> = {}): SmartLineTarget => ({
  line: 2, held_back: false, expected_total: 5400, expected_per_hour: 490.9, status: "ok",
  jobs: [{ sku: "AFCIB", order: 6000, expected: 5400 }], notes: [], source: "ahead",
  frozen_at: "2026-11-06T05:30:00Z", ...over,
});
const show = (t: SmartLineTarget | null, logged: string[] = []) =>
  render(<SmartTargetView state={t ? { kind: "target", target: t } : { kind: "none" }} loggedCodes={logged} />);

describe("the Smart Target on the line tablet", () => {
  it("shows the number made before the shift, per hour, and when it was set", () => {
    show(target());
    expect(screen.getByText("5,400")).toBeInTheDocument();
    expect(screen.getByText(/491 per hour · provisional/)).toBeInTheDocument();
    expect(screen.getByText(/Smart Target · set 05:30/)).toBeInTheDocument();
  });

  it("keeps the number and says the plan changed when an unplanned product is logged (Q40a)", () => {
    show(target(), ["AFCIB", "CARBBM"]);
    expect(screen.getByText("5,400")).toBeInTheDocument();
    expect(screen.getByText(/Plan changed since 05:30: CARBBM was not in it\. The target stays as set\./)).toBeInTheDocument();
  });

  it("never shows a number for a held-back line, nor for a line with no iTouch jobs", () => {
    show(target({ held_back: true, expected_total: null, jobs: [] }));
    expect(screen.getByText(/still being measured/)).toBeInTheDocument();
    show(target({ status: "no_itouch_jobs", expected_total: null, jobs: [] }));
    expect(screen.getByText(/No jobs were in iTouch before the shift/)).toBeInTheDocument();
  });

  it("shows a wide-margin line's number, with the caution beside it", () => {
    show(target({ line: 3, expected_total: 2903 }));
    expect(screen.getByText("2,903")).toBeInTheDocument();
    expect(screen.getByText(/usually misses by about 22%/)).toBeInTheDocument();
  });

  it("says so when no target was made, and shows nothing before BLOCO 149", () => {
    show(null);
    expect(screen.getByText("Not made for this shift.")).toBeInTheDocument();
    const { container } = render(<SmartTargetView state={{ kind: "not_installed" }} loggedCodes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
