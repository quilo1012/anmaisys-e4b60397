import { describe, it, expect } from "vitest";
import { awaitingResumeSummary } from "./awaitingResume";

/**
 * This count answers one question: how many maintenance orders are holding a line
 * down with nobody having resumed it. It does NOT know which machines are moving —
 * that lives in iTouching, is read by `classifyLive`, and the two are not the same
 * fact at the same minutes.
 *
 * On 13/08 at 09:27 UTC the old label produced a screen saying every line was running
 * while six machines stood still on the vendor's panel, one of them since 17:06 the
 * previous day. None of them had a work order, because none of them was a breakdown.
 *
 * These tests exist to stop that sentence coming back.
 */
describe("awaitingResumeSummary", () => {
  it("never claims the factory is running", () => {
    for (const n of [0, 1, 2, 7]) {
      const s = awaitingResumeSummary(n);
      const text = `${s.label} ${s.sublabel} ${s.ariaLabel}`.toLowerCase();
      expect(text).not.toMatch(/all lines/);
      expect(text).not.toMatch(/\brunning\b/);
      expect(text).not.toMatch(/production is down/);
    }
  });

  it("describes callouts awaiting a resume, not stopped lines", () => {
    const s = awaitingResumeSummary(3);
    expect(`${s.label} ${s.sublabel}`.toLowerCase()).toMatch(/resume/);
  });

  it("says nothing is waiting when the count is zero, and claims nothing more", () => {
    const s = awaitingResumeSummary(0);
    expect(s.sublabel.toLowerCase()).toMatch(/none|nothing|no /);
  });

  it("counts in the singular when there is one", () => {
    expect(awaitingResumeSummary(1).ariaLabel).toMatch(/1 maintenance order/i);
    expect(awaitingResumeSummary(1).ariaLabel).not.toMatch(/orders/i);
  });

  it("counts in the plural when there is more than one", () => {
    expect(awaitingResumeSummary(4).ariaLabel).toMatch(/4 maintenance orders/i);
  });

  it("points at the vendor's panel for the fact it cannot answer", () => {
    // A supervisor reading this must be able to tell that "0" is not an all-clear.
    expect(awaitingResumeSummary(0).sublabel.length).toBeGreaterThan(0);
    expect(awaitingResumeSummary(2).accent).toBe("warning");
    // Grey, not green. Zero callouts is not an all-clear, and the same grey is what
    // lineLiveStatus already uses for "I am not making a claim".
    expect(awaitingResumeSummary(0).accent).toBe("muted");
  });
});
