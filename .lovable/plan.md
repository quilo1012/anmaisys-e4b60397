# Fix: Recurrence reopen blocked after 1st time + login getting auto-signed-out

## Issue 1 — Operator can only "Open Recurrence" ONCE per work order

### Root cause confirmed in DB

Looking at recently reopened WOs (e.g. WO‑118, WO‑117, WO‑115, WO‑98) all have `reopen_count = 1` and `current_episode = 1`, with their `wo_episodes` row stuck at:

```
episode_number = 1, accepted_at = NULL, finished_at = NULL
```

What's happening, step by step:

1. Operator clicks **REPORT RECURRING FAILURE** → `reopen_wo_as_recurrence` runs.
2. RPC inserts an episode row with `accepted_at = NULL`, sets WO back to `status = 'open'`.
3. **Problem**: `finish_wo_with_pin` (and the engineer flow in general) **never updates `wo_episodes`** — it just flips the WO back to `finished`.
4. So the open episode stays with `accepted_at = NULL, finished_at = NULL` forever.

Now the **second** time the operator tries to reopen:

- The RPC tries to mark the previous episode finished using `_orig.current_episode` from `work_orders`. But because of historic rows where `current_episode` was never written by the original WO lifecycle, plus a stale value, the previous episode's `finished_at` may stay NULL.
- A new `episode_number = 2` is inserted, but the operator-side state machine never gets a clean handoff: the WO was already `open` from the previous reopen until the engineer finished it.

The visible UX symptom: **the "REPORT RECURRING FAILURE" button only shows when `status ∈ {finished, closed, completed}`**. After the first reopen the WO becomes `open`, so the button disappears. It only comes back after the engineer finishes again. If the engineer's finish path leaves the episode row in a bad state, subsequent reopens silently fail validation or produce no UI feedback.

### Fix plan

**1. Update `finish_wo_with_pin` (DB function)** — also close the current open episode:

```sql
UPDATE wo_episodes
   SET finished_at = COALESCE(finished_at, now())
 WHERE work_order_id = _wo_id
   AND finished_at IS NULL;
```

**2. Update `accept_wo_with_pin`** — set `accepted_at` on the current open episode:

```sql
UPDATE wo_episodes
   SET accepted_at = COALESCE(accepted_at, now())
 WHERE work_order_id = _wo_id
   AND episode_number = (SELECT current_episode FROM work_orders WHERE id = _wo_id)
   AND accepted_at IS NULL;
```

**3. Harden `reopen_wo_as_recurrence`** so it works even when no prior episode exists:
- Always close ALL open episodes (`finished_at IS NULL`) for that WO before inserting the new one.
- Compute `_new_episode = MAX(episode_number) + 1` (already correct).
- Force-update `current_episode = _new_episode` (already correct).
- Make sure the function is callable repeatedly: the only blocking guard should be `status NOT IN (finished/closed/completed) → wo_not_closed`. That is already the case.

**4. Backfill existing broken rows** (one-time migration):

```sql
UPDATE wo_episodes SET finished_at = now()
 WHERE finished_at IS NULL
   AND work_order_id IN (SELECT id FROM work_orders WHERE status = 'open' AND reopen_count >= 1);
```

After this, every "Open Recurrence" cycle will leave a clean trail and the operator can reopen as many times as needed (each time after the engineer signs off again).

---

## Issue 2 — Shared tablet accounts get logged out unexpectedly

### Root cause

Auth logs show a `token_revoked` event for `line1@appliednutrition.uk` immediately after a successful login. That account is a **shared tablet operator account** signed in on more than one device.

Supabase rotates refresh tokens on every refresh: when Tablet A refreshes, Tablet B's refresh token becomes invalid. On B's next refresh attempt the server returns `token_revoked` and B drops to the login screen — which is exactly what the user is reporting ("não permanece logado").

The current `AuthContext` already tries to be resilient (it ignores spurious `INITIAL_SESSION` nulls and never clears state on `TOKEN_REFRESHED` failure), **but it cannot survive a server-side `token_revoked`** because the next call simply has no valid token at all.

### Fix plan

**A. Auto re-login for shared Tablet accounts** (operator/tablet mode only)

The Login page already stores the chosen tablet account in `localStorage` under `an_tablet_account_id` plus the mode flag `an_login_mode = "tablet"`. Extend this:

1. When an operator logs in via Tablet mode with email + password, store the password reference in **a per-device encrypted form** so the tablet can transparently re-authenticate when its refresh token is revoked.
   - Use the existing `operator_line_accounts` table — passwords are already managed by the admin via `reset-operator-password` edge function. We don't need to store the plaintext password on the device; instead, issue a long-lived **device token** the first time a tablet pairs.
   - Simpler approach for now: store the operator account password in `localStorage` keyed to the tablet account id, **but only inside the Tablet mode flow** (never for staff/admin/manager/engineer).
2. In `AuthContext`, when a `SIGNED_OUT` event fires AND we are in Tablet mode AND we have stored credentials for the currently selected tablet account, attempt a silent `signInWithPassword` re-login before redirecting to `/login`.
3. If the silent re-login fails (password changed by admin, account deactivated, network), fall through to the normal `/login` redirect.

**B. Reduce refresh-token contention between tablets**

The simplest server-side mitigation: don't share refresh-token rotation across tablets. Two options, ordered by preference:

- **Preferred**: keep a single shared account but **disable refresh-token rotation** for tablets via a per-device check — not possible at Supabase Auth level today.
- **Pragmatic**: silently re-login on refresh failure (option A above). This is the fix we'll ship.

**C. Keep the admin deactivation guard intact**

The realtime listener that signs out a user when `profiles.active = false` must still win over the auto-relogin. Implementation:
- `forceSignOutInactive` already does a `window.location.replace("/login")` after clearing local state. Add a flag (`an_account_deactivated_until`) that suppresses the silent re-login for 30 seconds, so we never bounce a deactivated user straight back in.

### Files changed

- `supabase/migrations/<new>.sql` — DB: update `finish_wo_with_pin`, `accept_wo_with_pin`, `reopen_wo_as_recurrence`; backfill stale `wo_episodes`.
- `src/contexts/AuthContext.tsx` — silent re-login for Tablet mode on session loss; deactivation guard flag.
- `src/pages/Login.tsx` — when an operator successfully logs in via Tablet mode, persist the credentials needed for silent re-login (scoped to that account id only).

### Out of scope

- No changes to staff/admin/manager/engineer login flow — they must keep logging in normally.
- No changes to the `OperatorRecurrenceCard` UI — the visibility rule stays the same; the DB fixes make the cycle work end-to-end.

---

**Ready to apply once you approve.** Want me to proceed?
