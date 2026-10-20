/** Availability is a preference; connection leases never overwrite it.
 * The eventual server API must apply the same rules using its own clock and
 * authorization. This module does not authorize reads or trust browser heartbeats.
 */
export const AVAILABILITY_STATUSES = [
  "online", "busy", "do_not_disturb", "away", "offline", "on_holiday",
] as const;

export type AvailabilityStatus = typeof AVAILABILITY_STATUSES[number];

export const PRESENCE_HEARTBEAT_MS = 60_000;
export const PRESENCE_LEASE_MS = 180_000;

export function isAvailabilityStatus(value: unknown): value is AvailabilityStatus {
  return typeof value === "string" && AVAILABILITY_STATUSES.some((status) => status === value);
}

export interface PresenceSnapshot {
  preference: AvailabilityStatus;
  connected: boolean;
  /** Derived by the authorized server read; never return private leave records. */
  approvedHoliday: boolean;
}

/** null means unavailable/unknown, not a disconnected person. */
export function effectiveAvailability(snapshot: PresenceSnapshot | null): AvailabilityStatus | null {
  if (!snapshot) return null;
  if (snapshot.approvedHoliday || snapshot.preference === "on_holiday") return "on_holiday";
  if (snapshot.preference === "offline" || !snapshot.connected) return "offline";
  return snapshot.preference;
}

/** Evaluate authoritative lease expirations, not arbitrary client online flags.
 * No raw session IDs need to leave the server to compute this aggregate.
 */
export function hasActivePresence(expiresAt: readonly number[], nowMs: number): boolean {
  return expiresAt.some((expiry) => Number.isFinite(expiry) && expiry > nowMs);
}

/** Calendar day, deliberately not the Headcount operational date. */
export function presenceCalendarDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** This accepts an already-authorized approved holiday range, not every leave kind.
 * Approval filtering, employee linkage and private leave reads belong on the server.
 */
export function holidayRangeContains(from: string, to: string, calendarDate: string): boolean {
  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  return validDate(from) && validDate(to) && validDate(calendarDate)
    && from <= calendarDate && calendarDate <= to;
}