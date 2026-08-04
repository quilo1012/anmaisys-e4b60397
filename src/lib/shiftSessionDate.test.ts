import { describe, it, expect } from "vitest";
import { shiftSessionDate, shiftDateFetchRange } from "@/lib/shifts";

/**
 * The rule the factory stated: a night that starts on the 28th and ends at 06:00 on
 * the 29th is the 28th's night from end to end. Everything below is that sentence.
 */
describe("shiftSessionDate", () => {
  it("files the small hours of a night under the day it started", () => {
    // 02:00 on the 29th is the night that clocked on the evening of the 28th.
    expect(shiftSessionDate("2026-07-29T02:00:00Z", "NIGHT")).toBe("2026-07-28");
    // 04:59 UTC is 05:59 in London under BST — the last minute of the night.
    expect(shiftSessionDate("2026-07-29T04:59:00Z", "NIGHT")).toBe("2026-07-28");
    // One minute later London says 06:00 and the day crew has it.
    expect(shiftSessionDate("2026-07-29T05:00:00Z", "NIGHT")).toBe("2026-07-29");
  });

  it("keeps the evening half of a night on its own day", () => {
    expect(shiftSessionDate("2026-07-28T20:00:00Z", "NIGHT")).toBe("2026-07-28");
    expect(shiftSessionDate("2026-07-28T23:59:00Z", "NIGHT")).toBe("2026-07-28");
  });

  it("leaves the day shift on the calendar day", () => {
    expect(shiftSessionDate("2026-07-29T11:00:00Z", "DAY")).toBe("2026-07-29");
    expect(shiftSessionDate("2026-07-29T06:00:00Z", "DAY")).toBe("2026-07-29");
  });

  it("does not move imported rows that carry a synthetic midday stamp", () => {
    // The 20 rows already in the system are all stamped 11:00 with a real shift.
    // Reading the hour would file these nights under a day nobody worked; the
    // recorded shift wins and the date stands.
    expect(shiftSessionDate("2026-07-29T11:00:00Z", "NIGHT")).toBe("2026-07-29");
  });

  it("reads the clock in London, not UTC", () => {
    // 00:30 London on the 29th during BST is 23:30 UTC on the 28th. It is still the
    // night of the 28th either way, but the London hour is what decides.
    expect(shiftSessionDate("2026-07-28T23:30:00Z", "NIGHT")).toBe("2026-07-28");
  });

  it("treats a missing shift as a day", () => {
    expect(shiftSessionDate("2026-07-29T11:00:00Z", null)).toBe("2026-07-29");
  });
});

describe("shiftDateFetchRange", () => {
  it("reaches into the morning after so a closing night is not cut off", () => {
    const w = shiftDateFetchRange("2026-07-28", "2026-07-28");
    expect(w.gte).toBe("2026-07-28T00:00:00.000Z");
    expect(w.lte).toBe("2026-07-29T06:59:59.999Z");
  });

  it("covers every action that can belong to the range", () => {
    const w = shiftDateFetchRange("2026-07-27", "2026-07-29");
    // The last night of the range writes up to 05:59 on the 30th.
    expect(w.lte >= "2026-07-30T06:00:00.000Z").toBe(true);
    expect(w.gte <= "2026-07-27T00:00:00.000Z").toBe(true);
  });

  it("steps over a month end", () => {
    expect(shiftDateFetchRange("2026-07-31", "2026-07-31").lte).toContain("2026-08-01");
  });
});
