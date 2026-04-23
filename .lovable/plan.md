

## Fix the `permission denied for table profiles` (403) error

### Root cause

Migration `20260420110424` and `20260421084300` revoked column-level `SELECT` on `profiles.labor_rate` from `authenticated`. Postgres column-level grants enforce that **`SELECT *` fails with `42501` if any column lacks a grant** — even for admins, even when RLS would otherwise allow the row.

The active offender is `src/contexts/AuthContext.tsx` line 41:

```ts
supabase.from("profiles").select("*").eq("id", userId).single()
```

This runs on every login / token-refresh / USER_UPDATED event. It fails for **everyone** (admin included), which matches the 403 we see in the network log for the admin user. The app keeps running because `AuthContext` swallows the error in the `catch` block, but `profile` stays `null` — breaking any UI that depends on it (header name, profile-aware permissions, etc.).

A second offender is `src/hooks/useDowntimeEvents.ts` line 119, which only selects `name` (already safe — no fix needed), and `src/pages/dashboard/AnalyticsPage.tsx` line 81 which selects `id` only (also safe).

### Plan

**1. Replace `select("*")` in `AuthContext.tsx`** with the explicit non-sensitive column list that matches the column-level grants:

```ts
.select("id, name, email, shift, active, ui_preferences, last_seen_at, created_at, updated_at, labor_rate")
```

Wait — `labor_rate` is revoked. We must drop it from the list:

```ts
.select("id, name, email, shift, active, ui_preferences, last_seen_at, created_at, updated_at")
```

The `profile` object in `AuthContext` is typed as the full `profiles` row. We'll keep that type (the runtime object simply omits `labor_rate`, which is fine — no consumer reads it from the auth profile; admins fetch labor data via the `list_profile_labor_rates` / `get_own_labor_rate` RPCs).

**2. Verify no other consumer of `AuthContext.profile` reads `labor_rate`.** A grep for `profile?.labor_rate` / `profile.labor_rate` will confirm. If any are found, switch them to call `get_own_labor_rate()` RPC.

**3. Sanity-check the rest of the codebase** for any other `from("profiles").select("*")` patterns and convert them to explicit safe columns. Current scan shows only `AuthContext` is affected.

### Files changed

- `src/contexts/AuthContext.tsx` — replace `select("*")` with explicit safe-column list.
- (Conditional) any consumer found in step 2 that reads `profile.labor_rate`.

### Why this is the right fix (not an SQL migration)

- The column revoke is a **deliberate security hardening** — exposing `labor_rate` to all authenticated users would re-introduce a salary-leak finding.
- The frontend should never `select *` on `profiles` going forward; the safe column list is the contract.
- No RLS or grant change is required.

### What this does NOT change

- Manager engineer-management flow (already migrated to edge functions).
- Device-token RLS model (already reviewed and intentionally accepted).
- The `engineers_safe` view (already correct).

### Note on "3 critical issues"

Your message was cut off and the second/third issues weren't listed. Only the `profiles 403` is reproducible from the current network log and runtime state. Once you share the other two (or the truncated text), I'll fold them into this plan before implementing. If you'd like me to proceed with the profiles fix now and address the others as you confirm them, just say "go".

