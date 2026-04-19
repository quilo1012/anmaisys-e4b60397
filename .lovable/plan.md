
## System Audit — Issues & Fixes

### CRITICAL — Security (database)
1. **PIN exposure to managers** (HIGH RISK)
   - `profiles.pin` (bcrypt hash) readable by all managers via "Managers can view non-admin profiles"
   - `engineers.pin_hash` readable by all managers
   - **Fix:** Create a SQL migration that drops manager SELECT on these tables and recreates the policies through a `SECURITY DEFINER` view (`public.profiles_safe`, `public.engineers_safe`) that omits `pin`/`pin_hash`. Update frontend reads in `ManageUsers.tsx` and any engineer listing to use the safe view.

2. **Audit logs policy scoped to `public` role** — change role from `{public}` to `{authenticated}`.

3. **`user_roles` manager UPDATE WITH CHECK** missing `has_role(auth.uid(),'manager')` re-assertion — add it.

4. **Leaked password protection disabled** — enable in Auth settings.

### HIGH — Notification system bugs (functional)

5. **Missing `/public/alert.mp3` asset**
   - `CriticalAlertContext` references `/alert.mp3` which doesn't exist → `htmlAudio.play()` rejects silently. Only the WebAudio oscillator beep plays.
   - **Fix:** Generate a synthesized siren WAV (1s, looped) and write to `public/alert.mp3` via script. Engine then loops the real asset.

6. **Duplicate alerting** for engineers/admins
   - `useWOAlerts` (Engineer/Manager dashboards) AND `NotificationPanel` (DashboardLayout, all roles) BOTH subscribe to `work_orders` INSERT → engineer sees: critical red modal + sonner toast + radix toast + chime, all at once.
   - **Fix:** In `NotificationPanel`, skip `new_wo` notifications when role is `engineer` or `admin` (already covered by `useWOAlerts` critical modal). Keep panel notifications only for managers + status changes + low stock.

7. **Auto-acknowledge race condition** (`useWOAlerts.ts` line 91-97)
   - Any status change to `received`/`in_progress` calls `acknowledge()` → engineer A gets a popup, engineer B accepts the WO, engineer A's modal closes before they read it.
   - **Fix:** Only acknowledge if the WO ID matches the currently active alert (track active woId), OR only if the engineer who acknowledged is the current user. Pass the woId into `acknowledge(woId?)` and clear only matching alerts.

8. **NotificationPanel toast navigation** uses wrong path
   - Line 124: `navigate(\`/dashboard/work-orders/${n.woId}\`)` — but actual route is `/dashboard/wo/:id`.
   - **Fix:** Use `/dashboard/wo/${n.woId}`.

9. **`stopAlertSound` import is dead code** in `useWOAlerts.ts` — `shifts.ts` exports it as no-op. Remove the import and call (cleanup only).

### MEDIUM — Polish

10. **Title flash leaks original title** if alert triggers before mount — `originalTitleRef` captures `document.title` once at mount which is fine, but if user switched routes the title changed. Re-capture before flashing starts.

11. **Favicon badge** loads `originalFaviconHref` cross-origin — may fail on canvas taint. Add CORS handling fallback already present (good), but ensure favicon path is `/favicon.ico` not external.

### Files to change
- **NEW SQL migration**: secure profile/engineer views, fix audit_logs role scope, fix user_roles WITH CHECK
- **NEW** `scripts/gen-alert.mjs` + `public/alert.mp3` (generated 1s siren)
- `src/contexts/CriticalAlertContext.tsx` — `acknowledge(woId?)` signature, re-capture title
- `src/hooks/useWOAlerts.ts` — pass woId to acknowledge, remove dead import, dedupe with panel
- `src/components/NotificationPanel.tsx` — skip new_wo for engineer/admin, fix nav path
- `src/pages/users/ManageUsers.tsx` — switch reads to safe view (if affected)
- Auth config — enable leaked password protection

### Out of scope (defer)
- Push notifications (L2), escalation cron (L5), email/SMS (L6) — already deferred by user
- UI redesign

### Verification checklist after implementation
- [ ] Manager cannot SELECT pin/pin_hash columns (test query as manager)
- [ ] New WO triggers ONE critical modal for engineers (not duplicate toasts)
- [ ] Engineer A's alert stays visible when engineer B accepts a different WO
- [ ] Acknowledging closes only the matching alert; queued alerts surface next
- [ ] alert.mp3 plays in Chrome desktop after "Enable Alerts"
- [ ] Notification toast "Open" navigates to correct WO detail page
- [ ] Audit logs still visible to admins/managers; not to anonymous
