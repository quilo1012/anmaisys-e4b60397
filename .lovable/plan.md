

# Fix: Engineer Sound Notification Not Playing

## Root Cause

The `playAlertSound()` function creates a **new AudioContext** every time it's called. Modern browsers (Chrome, Firefox, Edge) **block AudioContext from producing sound** until the user has made at least one interaction (click, tap, key press) on the page. This is a browser autoplay policy.

If the engineer opens the dashboard and just waits without clicking anything, the AudioContext is created in a "suspended" state and produces no sound -- silently failing.

Additionally, the `catch` block only logs a warning, so the failure is invisible.

## Solution

1. **Reuse a single AudioContext** created lazily, and call `ctx.resume()` before playing to handle the suspended state.
2. **Add a user-gesture warmup**: on the first click/keypress anywhere on the page, resume the AudioContext so it's ready when a WO arrives.
3. **Add a visual fallback**: if sound fails, show a more prominent persistent alert (not just a toast) so the engineer never misses a WO.

## Technical Details

### File: `src/lib/shifts.ts`

Replace `playAlertSound()` with:
- A module-level `AudioContext` singleton (created on first call)
- A `warmUpAudio()` function that resumes the context on user gesture
- `playAlertSound()` that calls `ctx.resume()` before scheduling oscillators, and repeats the 3-beep pattern twice for emphasis

### File: `src/hooks/useWOAlerts.ts`

- Import and call `warmUpAudio()` inside a one-time `click`/`keydown` event listener on `document` to ensure the AudioContext is active before any WO arrives.
- Add `console.log` in the realtime callback so we can trace if the subscription is firing at all.

### File: `src/pages/dashboard/EngineerDashboard.tsx`

- Add a visual alert banner at the top when there are unacknowledged open WOs (WOs in "open" status), making missed notifications visually obvious even if sound fails.

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/shifts.ts` | Singleton AudioContext + resume + warmUpAudio export |
| `src/hooks/useWOAlerts.ts` | Warmup listener on user gesture + logging |
| `src/pages/dashboard/EngineerDashboard.tsx` | Visual alert banner for open WOs |

