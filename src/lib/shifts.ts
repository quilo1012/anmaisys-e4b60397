// Sound system fully removed. Only Web Notifications remain.
// Stub functions kept for backward compatibility with existing imports.

export type ShiftCode = "day" | "night";

/** Day shift: 06:00–17:59. Night shift: 18:00–05:59. */
export function getShift(date: Date | string): ShiftCode {
  const d = typeof date === "string" ? new Date(date) : date;
  const h = d.getHours();
  return h >= 6 && h < 18 ? "day" : "night";
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
