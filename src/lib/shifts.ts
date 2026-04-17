// Sound system fully removed. Only Web Notifications remain.
// Stub functions kept for backward compatibility with existing imports.

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
