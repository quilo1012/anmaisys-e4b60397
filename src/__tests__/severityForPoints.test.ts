import { describe, expect, it } from "vitest";
import { severityForPoints } from "@/lib/qualityConstants";

/** The default scale: low 1, medium 2, high 3, critical 4. */
const DEFAULTS = { low: 1, medium: 2, high: 3, critical: 4 };

describe("severityForPoints", () => {
  it("names the severity a number is worth", () => {
    expect(severityForPoints(4, DEFAULTS)).toBe("critical");
    expect(severityForPoints(2, DEFAULTS)).toBe("medium");
    expect(severityForPoints(1, DEFAULTS)).toBe("low");
  });

  it("returns null for a number no severity is worth", () => {
    // 5 is reachable only by pricing a label, which is not a severity.
    expect(severityForPoints(5, DEFAULTS)).toBeNull();
    expect(severityForPoints(0, DEFAULTS)).toBeNull();
  });

  it("treats an empty box as no severity, not as zero", () => {
    expect(severityForPoints(null, DEFAULTS)).toBeNull();
    expect(severityForPoints(Number.NaN, DEFAULTS)).toBeNull();
  });

  it("picks the most severe of two severities configured to the same weight", () => {
    // The weights editor allows duplicates. Guessing the milder one would let a
    // 3-point action be logged as High when the configuration says it could be
    // Critical — always resolve upward.
    expect(severityForPoints(3, { low: 1, medium: 2, high: 3, critical: 3 })).toBe("critical");
  });

  it("follows the configured weights, not the defaults", () => {
    expect(severityForPoints(10, { low: 1, medium: 2, high: 3, critical: 10 })).toBe("critical");
    expect(severityForPoints(4, { low: 1, medium: 2, high: 3, critical: 10 })).toBeNull();
  });
});
