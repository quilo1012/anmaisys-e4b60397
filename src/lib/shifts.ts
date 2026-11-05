// The shift clock moved to supabase/functions/_shared so the server-side Smart Target run
// (smart-target-ahead) uses the same code. The browser-only helpers stay here.
export * from "../../supabase/functions/_shared/production/shifts.ts";

export function warmUpAudio() { /* no-op */ }
export function playAlertSound() { /* no-op */ }
export function stopAlertSound() { /* no-op */ }
export function playNotificationChime() { /* no-op */ }

export function sendWebNotification(title: string, body: string) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "/favicon.ico" });
  } catch (e) {
    console.warn("[Notify] Failed to send notification", e);
  }
}
