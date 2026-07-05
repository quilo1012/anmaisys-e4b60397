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
