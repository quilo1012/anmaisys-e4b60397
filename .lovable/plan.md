

# Add Web Notifications API as Fallback for Sound Alerts

## Problem

The HTML5 Audio sound alert may still fail silently in some browsers or environments (e.g., muted devices, strict autoplay policies). Engineers need a guaranteed way to be notified about new Work Orders.

## Solution

Add the **Web Notifications API** as a secondary notification channel. When a new WO arrives, the system will:
1. Try to play the audio alert (existing behavior)
2. Also send a browser push notification that appears even if the tab is in the background

The notification permission will be requested on the first user gesture (same moment as audio warmup).

## Technical Details

### File: `src/lib/shifts.ts`

- Add `requestNotificationPermission()`: calls `Notification.requestPermission()` and logs the result
- Add `sendWebNotification(title, body)`: creates a `new Notification(title, { body, icon })` if permission is granted
- Export both functions

### File: `src/hooks/useWOAlerts.ts`

- Import `requestNotificationPermission` and `sendWebNotification`
- In the warmup gesture handler, also call `requestNotificationPermission()`
- In the realtime INSERT callback, after `playAlertSound()`, also call `sendWebNotification()` with the WO details

## Changes

| File | Change |
|------|--------|
| `src/lib/shifts.ts` | Add `requestNotificationPermission()` and `sendWebNotification()` |
| `src/hooks/useWOAlerts.ts` | Request permission on gesture, send notification on new WO |

