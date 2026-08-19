/**
 * The receipt has one job: never let a number appear without its arithmetic.
 *
 * These are about what reaches the screen, not about the sums — `pointsBreakdown` is
 * tested on its own in src/__tests__/pointsBreakdown.test.ts. What has to hold here
 * is that a score is not drawn before the attribution rule has loaded, and that a
 * label taken off the charge is named rather than silently dropped.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionScore } from "@/components/quality/ActionScore";
import { setLabelPoints } from "@/lib/qualityConstants";

const EXCLUDED = new Set(["maintenance"]);
const action = {
  domain: "quality" as string | null,
  severity: "critical" as string | null,
  labels: ["Batch code", "Maintenance"],
  validation_status: "open" as string | null,
};

afterEach(() => setLabelPoints({}));

describe("ActionScore", () => {
  it("draws no number until attribution has loaded", () => {
    // An empty exclusion set is a VALID answer meaning "nothing is excluded", so a
    // score drawn early is the unfiltered one — too high, against the wrong person,
    // and it settles a moment later as if it had been right all along.
    setLabelPoints({ "batch code": 2, maintenance: 3 });
    render(<ActionScore action={action} excluded={new Set()} ready={false} />);
    expect(screen.queryByText("5")).toBeNull();
    expect(screen.getByLabelText("Points loading")).toBeTruthy();
  });

  it("itemises the charge, and names what the exclusion took off", () => {
    setLabelPoints({ "batch code": 2, maintenance: 3 });
    // Low, not the fixture's Critical: this test is about the spared label appearing on
    // screen, and under MAX a Critical grade outranks the 2 the labels charge, which
    // rewrites the whole sentence being asserted.
    render(<ActionScore action={{ ...action, severity: "low" }} excluded={EXCLUDED} ready />);
    // "2" is on screen twice on purpose — the figure and the line item that produced
    // it — so the assertion is on the whole sentence, which is also what a screen
    // reader is given.
    expect(screen.getByLabelText(
      "Score: 2 points — Batch code 2. Maintenance is not the leader's, so its 3 is not charged.",
    )).toBeTruthy();
    // Both labels are on screen: the one charged and the one spared. Dropping the
    // spared line would make a reduced total look like a total that was never higher.
    expect(screen.getByText("Batch code")).toBeTruthy();
    expect(screen.getByText("Maintenance")).toBeTruthy();
    expect(screen.getByText("not the leader's")).toBeTruthy();
  });

  it("explains a zero rather than just printing one", () => {
    // Three different zeroes exist and only one of them is the leader's problem.
    render(<ActionScore action={{ ...action, domain: "safety" }} excluded={EXCLUDED} ready />);
    expect(screen.getByText(/Safety is counted, never charged/)).toBeTruthy();
  });

  it("says the grade paid when no label carries a price", () => {
    render(<ActionScore action={action} excluded={EXCLUDED} ready />);
    expect(screen.getByText(/from the Critical grade/)).toBeTruthy();
  });
});
