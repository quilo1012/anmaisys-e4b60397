

# Fix: Remove Shift Filter and Ensure Reliable Real-time Alerts

## Problem Diagnosis

After reviewing the code and database:

1. **Realtime IS enabled** -- `work_orders` is in the `supabase_realtime` publication, so the subscription should fire.
2. **The shift filter blocks notifications** -- In `useWOAlerts.ts`, the callback checks `isOnShift(profile?.shift)`. Since the user's profile has `shift: null`, the `isOnShift` function returns `true` (allows it), BUT this logic is unnecessary and confusing. The user wants to remove shifts entirely.
3. **Sound may still fail** -- The HTML5 Audio approach should work, but we need to verify the warmup is happening correctly.

## Changes

### 1. Remove shift logic from `src/hooks/useWOAlerts.ts`
- Remove the `isOnShift` check from the realtime callback -- all logged-in engineers receive alerts
- Remove the `profile` dependency (no longer needed for shift check)
- Keep `warmUpAudio`, `requestNotificationPermission`, `playAlertSound`, and `sendWebNotification`

### 2. Simplify `src/lib/shifts.ts`
- Remove `ShiftType`, `SHIFT_RANGES`, `getCurrentShift()`, and `isOnShift()` -- no longer used anywhere
- Keep only the audio and notification utility functions

### 3. Remove shift column usage from `src/pages/users/ManageUsers.tsx` (if shift editing exists)
- Remove the shift field from user edit forms since it's no longer relevant

### 4. Database migration
- Remove the `shift` column from the `profiles` table (optional, can be left as nullable and unused)
- OR simply stop using it in code (safer, no data loss)

## Technical Details

### `src/hooks/useWOAlerts.ts` -- Updated callback:

```text
// Before (blocks if not on shift):
if (!isOnShift(profile?.shift ?? null)) {
  console.log("[WOAlerts] Engineer not on shift, skipping");
  return;
}

// After (all logged-in engineers get alerts):
// No shift check -- if you're logged in as engineer, you get notified
```

### `src/lib/shifts.ts` -- Remove unused exports:

```text
// REMOVE: ShiftType, SHIFT_RANGES, getCurrentShift, isOnShift
// KEEP: warmUpAudio, playAlertSound, requestNotificationPermission, sendWebNotification
```

### Files to modify:

| File | Change |
|------|--------|
| `src/hooks/useWOAlerts.ts` | Remove `isOnShift` import and check from callback |
| `src/lib/shifts.ts` | Remove shift-related types and functions |
| `src/pages/users/ManageUsers.tsx` | Remove shift field from user edit form (if present) |

This ensures every engineer who is logged in and has the dashboard open will receive sound + web notification + toast when a new work order is created.

