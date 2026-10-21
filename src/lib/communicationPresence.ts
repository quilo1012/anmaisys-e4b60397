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

/** What the server knows about the person's working day today (Europe/London). Never the record behind it. */
export type WorkState = "holiday" | "absent" | "on_shift" | "off_shift";

export interface PresenceSnapshot {
  preference: AvailabilityStatus;
  connected: boolean;
  /** Derived by the authorized server read; never return private leave records. */
  approvedHoliday: boolean;
  /** Rota, attendance board and leave, read by the server. Null or missing = no opinion. */
  work?: WorkState | null;
}

/** null means unavailable/unknown, not a disconnected person. */
export function effectiveAvailability(snapshot: PresenceSnapshot | null): AvailabilityStatus | null {
  if (!snapshot) return null;
  if (snapshot.approvedHoliday || snapshot.work === "holiday" || snapshot.preference === "on_holiday") return "on_holiday";
  if (snapshot.work === "absent") return "offline";
  if (snapshot.preference === "offline" || !snapshot.connected) return "offline";
  // Only the default is moved by the rota: Busy, Do Not Disturb and Away are the person's own word.
  if (snapshot.work === "off_shift" && snapshot.preference === "online") return "away";
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

/* ───────────────────────────── display ───────────────────────────── */

export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  online: "Online",
  busy: "Busy",
  do_not_disturb: "Do Not Disturb",
  away: "Away",
  offline: "Offline",
  on_holiday: "On Holiday",
};

/** One line each, for the picker. Messages are delivered whatever is chosen. */
export const AVAILABILITY_HELP: Record<AvailabilityStatus, string> = {
  online: "Available to chat. Shows as Away outside your shift.",
  busy: "At work and may be slow to answer.",
  do_not_disturb: "Please only message if it matters.",
  away: "Not at your screen for now.",
  offline: "Appear offline. You still receive messages.",
  on_holiday: "Away on leave. You still receive messages.",
};

/** How often the client re-reads other people's status. Realtime covers choices; a lease that simply times out cannot announce itself. */
export const PRESENCE_REFRESH_MS = 30_000;

/** The most people one `communication_presence_for` call accepts. */
export const PRESENCE_MAX_IDS = 300;

/** A status the server sent, or null when it is not one of the six (never guessed at). */
export function parseAvailability(value: unknown): AvailabilityStatus | null {
  return isAvailabilityStatus(value) ? value : null;
}

/** Unique, non-empty ids in a stable order, so the same people always share one cache entry. */
export function stableIds(ids: readonly (string | null | undefined)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))).sort();
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * What the signed-in person's own picker should read. The server decides everyone else's
 * status; for yourself the preference is known and this tab is, by definition, connected.
 * Approved leave shows through exactly as it does for the people looking at you.
 */
export function myDisplayedAvailability(
  preference: AvailabilityStatus, approvedHoliday: boolean, automatic: AvailabilityStatus | null = null,
): AvailabilityStatus {
  if (automatic) return automatic;
  return effectiveAvailability({ preference, connected: true, approvedHoliday }) ?? preference;
}

/** Why the system is showing something other than the person's choice. */
export type AutomaticReason = "holiday" | "absence" | "off_shift";

export function parseAutomaticReason(value: unknown): AutomaticReason | null {
  return value === "holiday" || value === "absence" || value === "off_shift" ? value : null;
}

/** One line for the picker, said only to the person themselves. The choice is kept either way. */
export const AUTOMATIC_NOTE: Record<AutomaticReason, string> = {
  holiday: "Your leave or holiday today shows you as On Holiday. Your choice is kept and comes back after.",
  absence: "Today is recorded as an absence, so you show as Offline. Your choice is kept and comes back after.",
  off_shift: "You are outside your shift, so Online shows as Away. Busy and Do Not Disturb are never changed.",
};
