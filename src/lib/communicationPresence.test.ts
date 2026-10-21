import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_STATUSES, PRESENCE_HEARTBEAT_MS, PRESENCE_LEASE_MS,
  AVAILABILITY_LABEL, AVAILABILITY_HELP, PRESENCE_MAX_IDS,
  effectiveAvailability, hasActivePresence, holidayRangeContains,
  isAvailabilityStatus, presenceCalendarDate,
  parseAvailability, stableIds, chunk, myDisplayedAvailability,
} from "./communicationPresence";

describe("Communication availability rules", () => {
  it("permits exactly the six requested states", () => {
    expect(AVAILABILITY_STATUSES).toEqual([
      "online", "busy", "do_not_disturb", "away", "offline", "on_holiday",
    ]);
    expect(isAvailabilityStatus("on_break")).toBe(false);
    expect(isAvailabilityStatus("unknown")).toBe(false);
    expect(isAvailabilityStatus(null)).toBe(false);
    for (const state of AVAILABILITY_STATUSES) expect(isAvailabilityStatus(state)).toBe(true);
  });

  it.each(["online", "busy", "do_not_disturb", "away"] as const)(
    "keeps a connected user's %s preference",
    (preference) => expect(effectiveAvailability({ preference, connected: true, approvedHoliday: false })).toBe(preference),
  );

  it("keeps appear-offline while connected", () => {
    expect(effectiveAvailability({ preference: "offline", connected: true, approvedHoliday: false })).toBe("offline");
  });

  it("returns Offline without losing the saved preference on reconnect", () => {
    const snapshot = { preference: "busy" as const, connected: false, approvedHoliday: false };
    expect(effectiveAvailability(snapshot)).toBe("offline");
    expect(snapshot.preference).toBe("busy");
    expect(effectiveAvailability({ ...snapshot, connected: true })).toBe("busy");
  });

  it("approved holiday wins even over appear-offline or a disconnected session", () => {
    expect(effectiveAvailability({ preference: "offline", connected: false, approvedHoliday: true })).toBe("on_holiday");
  });

  it("manual holiday persists while disconnected", () => {
    expect(effectiveAvailability({ preference: "on_holiday", connected: false, approvedHoliday: false })).toBe("on_holiday");
  });

  it("restores the previous preference when approved holiday ends", () => {
    const snapshot = { preference: "do_not_disturb" as const, connected: true, approvedHoliday: true };
    expect(effectiveAvailability(snapshot)).toBe("on_holiday");
    expect(effectiveAvailability({ ...snapshot, approvedHoliday: false })).toBe("do_not_disturb");
  });

  it("does not call missing information Offline", () => {
    expect(effectiveAvailability(null)).toBeNull();
  });
});

describe("Connection lease rules", () => {
  it("renews every 60 seconds with a 180-second grace", () => {
    expect(PRESENCE_HEARTBEAT_MS).toBe(60_000);
    expect(PRESENCE_LEASE_MS).toBe(180_000);
  });

  it("survives a brief interruption but expires at exactly 180 seconds", () => {
    const lastBeat = 1_000_000;
    const expiry = lastBeat + PRESENCE_LEASE_MS;
    expect(hasActivePresence([expiry], lastBeat + 120_000)).toBe(true);
    expect(hasActivePresence([expiry], lastBeat + 179_999)).toBe(true);
    expect(hasActivePresence([expiry], lastBeat + 180_000)).toBe(false);
  });

  it("one live device keeps the user connected when another has expired", () => {
    expect(hasActivePresence([900, 1200], 1000)).toBe(true);
    expect(hasActivePresence([900], 1000)).toBe(false);
    expect(hasActivePresence([], 1000)).toBe(false);
  });

  it("rejects invalid lease expirations", () => {
    expect(hasActivePresence([NaN, Infinity, -Infinity], 1000)).toBe(false);
  });
});

describe("Approved holiday date rules", () => {
  it("includes both boundary dates and intervening non-working days", () => {
    for (const day of ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"])
      expect(holidayRangeContains("2026-10-23", "2026-10-26", day)).toBe(true);
    expect(holidayRangeContains("2026-10-23", "2026-10-26", "2026-10-22")).toBe(false);
    expect(holidayRangeContains("2026-10-23", "2026-10-26", "2026-10-27")).toBe(false);
  });

  it("uses London midnight rather than the night board's previous operational day", () => {
    expect(presenceCalendarDate(new Date("2026-10-20T23:30:00Z"))).toBe("2026-10-21");
  });

  it("does not shift the holiday day when the UK clocks change", () => {
    expect(presenceCalendarDate(new Date("2026-10-25T00:30:00Z"))).toBe("2026-10-25");
    expect(presenceCalendarDate(new Date("2026-10-25T01:30:00Z"))).toBe("2026-10-25");
    expect(presenceCalendarDate(new Date("2026-10-25T23:30:00Z"))).toBe("2026-10-25");
  });

  it("rejects backwards and invalid holiday dates", () => {
    expect(holidayRangeContains("2026-10-26", "2026-10-23", "2026-10-24")).toBe(false);
    expect(holidayRangeContains("2026-02-30", "2026-03-03", "2026-03-01")).toBe(false);
    expect(holidayRangeContains("2026-10-23", "2026-10-26", "not-a-date")).toBe(false);
  });
});

describe("Availability display helpers", () => {
  it("names and explains exactly the six statuses, in English, and never On Break", () => {
    expect(Object.keys(AVAILABILITY_LABEL).sort()).toEqual([...AVAILABILITY_STATUSES].sort());
    expect(Object.keys(AVAILABILITY_HELP).sort()).toEqual([...AVAILABILITY_STATUSES].sort());
    expect(Object.values(AVAILABILITY_LABEL)).toEqual(
      ["Online", "Busy", "Do Not Disturb", "Away", "Offline", "On Holiday"]);
    expect(JSON.stringify([AVAILABILITY_LABEL, AVAILABILITY_HELP])).not.toMatch(/break/i);
  });

  it("says in the picker that messages are still delivered while offline or on holiday", () => {
    expect(AVAILABILITY_HELP.offline).toMatch(/still receive messages/);
    expect(AVAILABILITY_HELP.on_holiday).toMatch(/still receive messages/);
  });

  it("accepts only the server's six words", () => {
    for (const s of AVAILABILITY_STATUSES) expect(parseAvailability(s)).toBe(s);
    expect(parseAvailability("on_break")).toBeNull();
    expect(parseAvailability("ONLINE")).toBeNull();
    expect(parseAvailability(undefined)).toBeNull();
  });

  it("keeps one cache entry for the same people in any order", () => {
    expect(stableIds(["b", "a", "b", "", null, undefined, "c"])).toEqual(["a", "b", "c"]);
  });

  it("splits a long list below the server's limit of 300", () => {
    const ids = Array.from({ length: 650 }, (_, i) => String(i));
    const parts = chunk(ids, PRESENCE_MAX_IDS);
    expect(parts.map((p) => p.length)).toEqual([300, 300, 50]);
    expect(parts.flat()).toEqual(ids);
    expect(chunk([], PRESENCE_MAX_IDS)).toEqual([]);
  });

  it("shows your own picker the same thing everybody else is shown", () => {
    expect(myDisplayedAvailability("busy", false)).toBe("busy");
    expect(myDisplayedAvailability("offline", false)).toBe("offline");
    expect(myDisplayedAvailability("busy", true)).toBe("on_holiday");
    expect(myDisplayedAvailability("on_holiday", false)).toBe("on_holiday");
  });
});
