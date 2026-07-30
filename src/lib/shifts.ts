// Sound system fully removed. Only Web Notifications remain.
// Stub functions kept for backward compatibility with existing imports.

export type ShiftCode = "day" | "night";

function londonParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: Number(get("hour")),
  };
}

function londonDateString(date: Date) {
  const p = londonParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Day shift: 06:00–17:59 London time. Night shift: 18:00–05:59 London time. */
export function getShift(date: Date | string): ShiftCode {
  const d = typeof date === "string" ? new Date(date) : date;
  const h = londonParts(d).hour;
  return h >= 6 && h < 18 ? "day" : "night";
}

export function getCurrentFactoryShift(date = new Date()): { sessionDate: string; shiftCode: ShiftCode } {
  const h = londonParts(date).hour;
  if (h >= 6 && h < 18) return { sessionDate: londonDateString(date), shiftCode: "day" };
  if (h >= 18) return { sessionDate: londonDateString(date), shiftCode: "night" };
  const previous = new Date(date);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return { sessionDate: londonDateString(previous), shiftCode: "night" };
}

/** How far Europe/London local is ahead of UTC (ms) at the given instant. */
function londonOffsetMs(atUtcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(atUtcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  let hh = g("hour"); if (hh === 24) hh = 0;
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), hh, g("minute"), g("second"));
  return asUtc - atUtcMs;
}

/** UTC instant for a Europe/London wall-clock time (offset resolved at the boundary). */
export function londonWallToUtc(y: number, mo: number, d: number, h: number): number {
  const naive = Date.UTC(y, mo - 1, d, h, 0, 0);
  return naive - londonOffsetMs(naive);
}

/**
 * When production logging closes for a shift: 18:15 for DAY, 06:15 the next
 * morning for NIGHT, Europe/London — 15 minutes after the shift ends.
 *
 * Mirrors session_write_deadline() in the database, which is the authority. This
 * exists so the UI can warn before the door shuts instead of letting an operator
 * discover it by having a save refused.
 */
export function shiftLoggingDeadline(sessionDate: string, shift: "DAY" | "NIGHT"): Date {
  const [y, mo, d] = sessionDate.split("-").map(Number);
  const at = (day: number, h: number, min: number) =>
    new Date(londonWallToUtc(y, mo, day, h) + min * 60_000);
  return shift === "NIGHT" ? at(d + 1, 6, 15) : at(d, 18, 15);
}

/**
 * Start instant of the current factory shift (Day 06:00, Night 18:00 Europe/London).
 * Built from the actual boundary instant so it stays correct across the BST/GMT
 * DST switches (the old version assumed 1 wall-clock hour == 3600 real seconds).
 */
export function getCurrentShiftStart(now: Date = new Date()): Date {
  const { sessionDate, shiftCode } = getCurrentFactoryShift(now);
  const [y, mo, d] = sessionDate.split("-").map(Number);
  return new Date(londonWallToUtc(y, mo, d, shiftCode === "day" ? 6 : 18));
}

/** End instant of the current factory shift (Day 18:00, Night 06:00 next day, Europe/London). */
export function getCurrentShiftEnd(now: Date = new Date()): Date {
  const { sessionDate, shiftCode } = getCurrentFactoryShift(now);
  const [y, mo, d] = sessionDate.split("-").map(Number);
  if (shiftCode === "day") return new Date(londonWallToUtc(y, mo, d, 18));
  const next = new Date(Date.UTC(y, mo - 1, d + 1));
  return new Date(londonWallToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 6));
}

export const SHIFT_LABEL: Record<ShiftCode, string> = {
  day: "Day Shift (06:00–18:00)",
  night: "Night Shift (18:00–06:00)",
};


export function warmUpAudio() { /* no-op */ }
export function playAlertSound() { /* no-op */ }
export function stopAlertSound() { /* no-op */ }
export function playNotificationChime() { /* no-op */ }

export async function requestNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted" || Notification.permission === "denied") return;
  try {
    await Notification.requestPermission();
  } catch (e) {
    console.warn("[Notify] Permission request failed", e);
  }
}

export function sendWebNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch (e) {
    console.warn("[Notify] Failed to send notification", e);
  }
}
