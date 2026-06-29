import { describe, it, expect } from "vitest";
import { formatDuration, formatMinutes } from "@/lib/formatDuration";

// The project-wide formatter always renders "Xh Ym" from seconds.
describe("formatDuration (seconds → 'Xh Ym')", () => {
  it("0s → 0h 0m", () => {
    expect(formatDuration(0)).toBe("0h 0m");
  });
  it("60s (1 min) → 0h 1m", () => {
    expect(formatDuration(60)).toBe("0h 1m");
  });
  it("90 minutes (5400s) → 1h 30m", () => {
    expect(formatMinutes(90)).toBe("1h 30m");
  });
  it("1h (3600s) → 1h 0m", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
  });
  it("null → em-dash", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

// SLA matrix used by the WO scheduling engine (minutes).
const SLA_MINUTES = {
  LOW: 120,
  MEDIUM: 60,
  HIGH: 30,
  CRITICAL: 10,
} as const;

describe("Work-order SLA matrix", () => {
  it("matches contract durations", () => {
    expect(SLA_MINUTES.LOW).toBe(120);
    expect(SLA_MINUTES.MEDIUM).toBe(60);
    expect(SLA_MINUTES.HIGH).toBe(30);
    expect(SLA_MINUTES.CRITICAL).toBe(10);
  });
  it("priorities are strictly descending", () => {
    expect(SLA_MINUTES.LOW).toBeGreaterThan(SLA_MINUTES.MEDIUM);
    expect(SLA_MINUTES.MEDIUM).toBeGreaterThan(SLA_MINUTES.HIGH);
    expect(SLA_MINUTES.HIGH).toBeGreaterThan(SLA_MINUTES.CRITICAL);
  });
});
