import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_STATUSES, PRESENCE_HEARTBEAT_MS, PRESENCE_LEASE_MS,
  AVAILABILITY_LABEL, AVAILABILITY_HELP, PRESENCE_MAX_IDS,
  effectiveAvailability, hasActivePresence, holidayRangeContains,
  isAvailabilityStatus, presenceCalendarDate,
  parseAvailability, parseAutomaticReason, stableIds, chunk, myDisplayedAvailability,
  type AvailabilityStatus, type WorkState,
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

describe("work state (rota, attendance board, leave)", () => {
  const live = (preference: AvailabilityStatus, work: WorkState | null) =>
    effectiveAvailability({ preference, connected: true, approvedHoliday: false, work });

  it("moves only Online outside the shift: Busy, Do Not Disturb and Away are the person's word", () => {
    expect(live("online", "off_shift")).toBe("away");
    expect(live("busy", "off_shift")).toBe("busy");
    expect(live("do_not_disturb", "off_shift")).toBe("do_not_disturb");
    expect(live("away", "off_shift")).toBe("away");
  });

  it("leaves the choice alone on shift, and when the server has no opinion", () => {
    expect(live("online", "on_shift")).toBe("online");
    expect(live("online", null)).toBe("online");
    expect(effectiveAvailability({ preference: "online", connected: true, approvedHoliday: false })).toBe("online");
  });

  it("reads holiday as On Holiday over every choice, and absence as Offline", () => {
    for (const preference of AVAILABILITY_STATUSES) expect(live(preference, "holiday")).toBe("on_holiday");
    for (const preference of AVAILABILITY_STATUSES.filter((p) => p !== "on_holiday")) expect(live(preference, "absent")).toBe("offline");
    expect(live("on_holiday", "absent")).toBe("on_holiday");
  });

  it("never invents Away for someone who is not connected", () => {
    expect(effectiveAvailability({ preference: "online", connected: false, approvedHoliday: false, work: "off_shift" })).toBe("offline");
  });

  it("shows the owner the automatic state when there is one", () => {
    expect(myDisplayedAvailability("online", false, "away")).toBe("away");
    expect(myDisplayedAvailability("busy", false, "on_holiday")).toBe("on_holiday");
    expect(myDisplayedAvailability("busy", false, null)).toBe("busy");
  });

  it("only accepts the three reasons the server gives", () => {
    expect(parseAutomaticReason("holiday")).toBe("holiday");
    expect(parseAutomaticReason("absence")).toBe("absence");
    expect(parseAutomaticReason("off_shift")).toBe("off_shift");
    expect(parseAutomaticReason("sick")).toBeNull();
    expect(parseAutomaticReason(null)).toBeNull();
  });
});
