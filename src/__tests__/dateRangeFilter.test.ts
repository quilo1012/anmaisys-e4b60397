import { describe, it, expect } from "vitest";
import { getPresetRange } from "@/components/DateRangeFilter";

/** The hour a Date falls on in London — how the factory defines every shift. */
function londonHour(d: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(d),
  );
}

describe("getPresetRange('shift')", () => {
  it("starts at 06:00 or 18:00 London time, whichever shift is running", () => {
    const { from, to } = getPresetRange("shift");
    expect(from).toBeInstanceOf(Date);
    expect(to).toBeInstanceOf(Date);
    // Regression: this used the browser's local hour and setHours, so on a device in
    // another timezone the range began at neither boundary.
    expect([6, 18]).toContain(londonHour(from!));
  });

  it("never starts in the future", () => {
    const { from, to } = getPresetRange("shift");
    expect(from!.getTime()).toBeLessThanOrEqual(to!.getTime());
  });

  it("covers at most 12 hours — one shift, not two", () => {
    const { from, to } = getPresetRange("shift");
    const hours = (to!.getTime() - from!.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThanOrEqual(0);
    expect(hours).toBeLessThanOrEqual(12);
  });
});

describe("getPresetRange('all')", () => {
  it("is an open range, so nothing is filtered out", () => {
    expect(getPresetRange("all")).toEqual({});
  });
});
