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
    // Both ends are London wall-clock, and July is BST: midnight on the 28th is
    // 23:00 UTC on the 27th, and 06:00 on the 29th is 05:00 UTC.
    expect(w.gte).toBe("2026-07-27T23:00:00.000Z");
    expect(w.lte).toBe("2026-07-29T04:59:59.999Z");
  });

  it("is the same window in winter, when London is UTC", () => {
    const w = shiftDateFetchRange("2026-01-15", "2026-01-15");
    expect(w.gte).toBe("2026-01-15T00:00:00.000Z");
    expect(w.lte).toBe("2026-01-16T05:59:59.999Z");
  });

  /**
   * The hour the old window could not see.
   *
   * It opened at `${from}T00:00:00.000Z`, which under BST is 01:00 in London. An action
   * stamped 23:30 UTC on the 27th is 00:30 on the 28th in London, and with a DAY shift
   * column `shiftSessionDate` files it on the 28th — the day the period asked for.
   * It was never fetched, and nothing on any screen said a row was missing.
   */
  it("opens at London midnight, not at UTC midnight", () => {
    const w = shiftDateFetchRange("2026-07-28", "2026-07-28");
    const earlyHours = "2026-07-27T23:30:00.000Z";
    expect(shiftSessionDate(earlyHours, "DAY")).toBe("2026-07-28");
    expect(w.gte <= earlyHours).toBe(true);
  });

  it("covers every action that can belong to the range, and nothing that cannot", () => {
    const w = shiftDateFetchRange("2026-07-27", "2026-07-29");
    // The last night of the range writes up to 05:59 in London on the 30th, which is
    // 04:59 UTC — the comment this test has always carried, now asserted in the zone
    // it was written about.
    const lastOfTheNight = "2026-07-30T04:59:00.000Z";
    expect(shiftSessionDate(lastOfTheNight, "NIGHT")).toBe("2026-07-29");
    expect(w.lte >= lastOfTheNight).toBe(true);

    // One minute later London says 06:00, the day crew has it, and its session date is
    // the 30th — outside the range however the fetch is written.
    const firstOfTheDay = "2026-07-30T05:00:00.000Z";
    expect(shiftSessionDate(firstOfTheDay, "NIGHT")).toBe("2026-07-30");
    expect(w.lte < firstOfTheDay).toBe(true);
  });

  it("steps over a month end", () => {
    expect(shiftDateFetchRange("2026-07-31", "2026-07-31").lte).toContain("2026-08-01");
  });

  it("gets both ends right across the BST/GMT switch", () => {
    // Clocks go back at 02:00 on 25/10/2026: the near end is still BST, the far end is
    // already GMT, so a window built by adding a fixed offset would be an hour out at
    // one of them.
    const w = shiftDateFetchRange("2026-10-24", "2026-10-25");
    expect(w.gte).toBe("2026-10-23T23:00:00.000Z");
    expect(w.lte).toBe("2026-10-26T05:59:59.999Z");
  });
});
