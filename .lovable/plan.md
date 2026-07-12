
# Read-only security & reliability audit — AN Maintenance

Scope: SECURITY, AUTH & ROLES, DATA INTEGRITY, RELIABILITY. No code, DB, or config changes performed. Findings ordered by severity within each section.

---

## 1) SECURITY

### CRITICAL

**S-C1. Hardcoded shared tablet password in client bundle + migrations**
- Files: `supabase/functions/tablet-signin/index.ts:10` (`DEFAULT_TABLET_PASSWORD = "Tablet@AN2026!"`), `src/components/OperatorAccountsSection.tsx:394,419,961`, migrations `20260426082222…sql`, `20260711123717…sql`, `20260711124951…sql`.
- Risk: The single shared password for every tablet operator account is baked into the client bundle (published on `anmaisys.lovable.app`), edge function, and migration history. Anyone with the bundle can sign in as any operator.
- Fix (describe): Move the default to a server-only env secret (e.g. `TABLET_DEFAULT_PASSWORD`) referenced only inside `tablet-signin`; strip literals from UI + migrations; force per-tablet password rotation on first sign-in.

**S-C2. Privileged admin edge functions run with `verify_jwt = false`**
- File: `supabase/config.toml` — functions `create-user`, `update-user`, `delete-user`, `create-engineer`, `update-engineer`, `delete-engineer`, `list-engineers`, `create-operator-account`, `reset-operator-password`.
- Risk: The gateway does NOT validate the caller's JWT. Each function does its own bearer parse + `has_role` check; any bug in that path makes them publicly invokable with service-role privileges (user creation, password reset, engineer deletion).
- Fix: Set `verify_jwt = true` for every function that is not an unauthenticated webhook (only `tablet-signin` and `intouch-webhook` should stay open). Keep the internal `has_role` check as defense in depth.

**S-C3. `intouch-webhook` accepts payloads when shared secret is unset**
- File: `supabase/functions/intouch-webhook/index.ts:16` (`WEBHOOK_SECRET = Deno.env.get(...) ?? ""`).
- Risk: If the env var is missing/empty, comparison against a missing `X-Webhook-Secret` header succeeds → anyone can inject fake Intouch events, spawn WOs, poison metrics.
- Fix: Refuse to boot / return 503 when `WEBHOOK_SECRET` is empty; require constant-time compare against a non-empty header.

### HIGH

**S-H1. Three tables have a `USING (true)` SELECT policy for `authenticated`**
- Tables/policies (from `pg_policies`): `line_production_baselines` ("Authenticated can read baselines"), `rag_weekly_comments` ("Authenticated can read rag comments"), `sku_line_speeds` ("Authenticated can read sku_line_speeds").
- Risk: Any signed-in role — including `viewer` and `operator` — can read production baselines, manager comments, and SKU speeds. Comments in particular may contain sensitive shift notes.
- Fix: Replace with role-scoped `USING (has_role(auth.uid(),'admin') OR has_role(...,'manager') OR has_role(...,'maintenance_manager'))`, or add a `RESTRICTIVE` policy limiting to management roles.

**S-H2. Service-role client used inside functions that only manually parse `Authorization`**
- Files: `supabase/functions/clear-system/index.ts`, `clear-audit-logs/index.ts`, `create-user/index.ts`, `update-user/index.ts`, `delete-user/index.ts`, `create-engineer/index.ts`, `update-engineer/index.ts`, `delete-engineer/index.ts`, `create-operator-account/index.ts`, `reset-operator-password/index.ts`, `update-operator-email/index.ts`, `update-admin-pin/index.ts`, `verify-admin-pin/index.ts`.
- Risk: All hold `SUPABASE_SERVICE_ROLE_KEY` and only a manual JWT check. Combined with S-C2, a crafted request bypassing the regex triggers full row deletion (`clear-system` wipes `work_orders`, `wo_messages`, `parts_used`, `engineer_scores`).
- Fix: (a) enable `verify_jwt`, (b) centralize auth via a shared helper using `supabase.auth.getClaims(token)`, (c) reject on missing claims instead of falling through.

**S-H3. `SECURITY DEFINER` functions are `EXECUTE`-able by `public`/`authenticated`**
- Source: Supabase linter — 78 warnings (categories 0028/0029).
- Risk: Helpers like `verify_pin_by_code`, `get_device_line`, `get_own_labor_rate`, `pair_device*`, `unpair_device`, `has_role` are callable by anon or all authenticated users. `verify_pin_by_code` in particular allows anon brute-force of 4-digit engineer PINs.
- Fix: `REVOKE EXECUTE … FROM public, anon` on every SECURITY DEFINER function; `GRANT EXECUTE` only to the specific role that needs it (`authenticated` or `service_role`), and keep the internal role assertions.

### MEDIUM

**S-M1. `pin_attempts` has a single RLS policy — verify write scope**
- Table: `pin_attempts` (1 policy).
- Risk: If policy is INSERT-open, attackers can flood rate-limit trail; if SELECT-open, PIN attempt telemetry leaks. Unknown from linter alone.
- Fix: Confirm policy allows only service-role writes and admin reads.

**S-M2. Extension installed in `public` schema** (linter WARN 1)
- Risk: Standard Supabase hygiene warning; low real impact but recommended to move to `extensions` schema.

---

## 2) AUTH & ROLES

### HIGH

**A-H1. `co_engineer` mirror is enforced client-side only**
- File: `src/components/ProtectedRoute.tsx:117` (`effectiveRole = role === "co_engineer" ? "engineer" : role`), `src/lib/permissions.ts` (MATRIX lists both explicitly).
- Risk: RLS/DB checks key on the raw role. DB functions that check `has_role(uid,'engineer')` will reject a `co_engineer`, producing UI-vs-DB drift (button visible, action rejected).
- Fix: Either (a) dual-insert `engineer` role in `user_roles` when granting `co_engineer`, or (b) add explicit `has_role(...,'co_engineer')` branches in every relevant policy/function.

**A-H2. `tablet-signin` auto-resets password to the known default on failure**
- File: `supabase/functions/tablet-signin/index.ts:179-190`.
- Risk: If sign-in fails AND the submitted password equals `DEFAULT_TABLET_PASSWORD`, the function rewrites the auth user's password to the default. An attacker who knows the constant (see S-C1) can permanently reset any operator account back to the default by submitting it once — no admin needed.
- Fix: Remove the auto-repair branch; require admin-initiated reset via `reset-operator-password`.

**A-H3. Rate limiting is per-instance, in-memory only**
- Files: `supabase/functions/tablet-signin/index.ts:15-20`, `src/lib/loginRateLimit.ts`.
- Risk: Edge instances scale horizontally, so a distributed attacker gets ~5 attempts per instance. Client-side limiter is trivially bypassed by clearing storage.
- Fix: Persist attempts in DB (`pin_attempts` or dedicated table) keyed by `(account_id, ip)` and enforce server-side.

### MEDIUM

**A-M1. `roleDashMap` sends `viewer` to `/dashboard/manager`**
- File: `src/lib/permissions.ts:97`.
- Risk: Confusing redirect; any weakly guarded manager subroute becomes reachable if a check is missed.
- Fix: Add a dedicated read-only landing page for `viewer`.

**A-M2. `wo.delete` allow-list vs. DB DELETE policy**
- File: `src/lib/permissions.ts` (matrix restricts to `admin`; comment says manager loses delete in Phase 5).
- Risk: Verify the DB DELETE policy on `work_orders` (14 policies) matches; UI-only gate is bypassable by direct API call.
- Fix: Cross-check `pg_policies` DELETE clause; align.

**A-M3. Silent re-login window in `ProtectedRoute`**
- File: `src/components/ProtectedRoute.tsx:64-77`.
- Risk: While `silentReLoginInFlight` is true a stale session is trusted; if the recovery ultimately fails there is no fallback timeout.
- Fix: Add a timeout that redirects to `/login` after N seconds.

---

## 3) DATA INTEGRITY

### HIGH

**D-H1. Recent migrations write directly to `auth.users.encrypted_password`**
- Files: `supabase/migrations/20260426082222_…sql`, `20260711123717_…sql`, `20260711124951_…sql`.
- Risk: Direct writes bypass Supabase's auth admin API (also violates the rule against modifying the `auth` schema). Any restore/branch merge re-runs the migration and silently resets every tablet account back to the hardcoded password. Recent 401 incidents trace here.
- Fix: Guard with idempotency checks; move logic into an edge function invoked once via `admin.auth.admin.updateUserById()`; rotate the default password after the run.

**D-H2. Orphan / duplicate columns on `work_orders`**
- File: `work_orders` schema (53 columns).
- Risk: `accepted_at` referenced defensively in `src/pages/dashboard/WorkOrderDetail.tsx:193` while writes only touch `received_at`. `line_at_time` duplicates `line_id`. Two SECURITY DEFINER "reopen" RPCs (`reopen_wo_recurrence` vs `reopen_wo_as_recurrence`) diverge.
- Fix: Inventory columns; drop unused; deprecate one reopen RPC.

### MEDIUM

**D-M1. Likely missing indexes on hot filter columns**
- Hooks scanning heavy tables: `useWorkOrders` (`status`, `created_at`, `line_id`), `useWOAlerts` (`status`, `engineer_notified_acknowledged_at`), `useWOMessages` (`work_order_id`, `created_at`), `ProductionPerformancePage` (`session_date`, `line`, `shift`), Line Chat (`line_id`, `created_at`), `audit_logs` (`user_id`, `created_at`).
- Risk: Sequential scans as row counts grow.
- Fix: Run `EXPLAIN` on those queries; add composite indexes where seq scans appear.

**D-M2. `sync_items_target_from_rag` overwrites manual per-SKU targets**
- Source: db-function definition.
- Risk: Rewrites all `production_items.target_qty` whenever `plan_qty` changes, ignoring `target_manual_at` / `target_manual_by`.
- Fix: Skip rows where `target_manual_at IS NOT NULL`.

**D-M3. `handle_new_user` "first user becomes admin" race**
- Source: db-function.
- Risk: Uses `FOR UPDATE` on `profiles` but the check is racy across two concurrent signups in an empty DB (already low risk today but could return in dev/staging resets).
- Fix: Move first-admin bootstrap to a one-shot migration or edge function.

---

## 4) RELIABILITY

### HIGH

**R-H1. `tablet-signin` writes to `auth.users` outside the auth admin API**
- File: `supabase/functions/tablet-signin/index.ts` (auto-repair path).
- Risk: Direct writes desync `auth.identities` and can corrupt identity rows; the recent 401 loops trace back here.
- Fix: Use `admin.auth.admin.updateUserById()` exclusively; never touch `auth.users` directly.

**R-H2. Fire-and-forget notifications lack error swallowing**
- Files: `src/hooks/useWOAlerts.ts`, `src/contexts/CriticalAlertContext.tsx`, `src/components/NotificationPanel.tsx`, `supabase/functions/notify-teams/index.ts`, `notify-line-chat/index.ts`.
- Risk: A rejected fetch (Teams webhook down, browser notification blocked) surfaces as an unhandled promise rejection; on tablets this can crash the WebView.
- Fix: Wrap in `try/catch` + telemetry sink; add `.catch(logAndSwallow)` on all fire-and-forget promises.

### MEDIUM

**R-M1. `clear-system` performs unbounded deletes without a transaction**
- File: `supabase/functions/clear-system/index.ts`.
- Risk: Partial failure leaves the DB half-wiped.
- Fix: Wrap in a single RPC transaction; add a `dry_run` flag.

**R-M2. Realtime subscriptions may double-fire after silent re-login**
- Files: `src/contexts/AuthContext.tsx`, `src/hooks/useWOAlerts.ts`.
- Fix: On `SIGNED_IN` after silent re-login, re-establish channel with a fresh unique id and cleanup the old one.

### LOW

**R-L1. `ProtectedRoute` can render "Loading permissions…" indefinitely**
- File: `src/components/ProtectedRoute.tsx:110-118`.
- Risk: If role fetch silently fails after session loads, spinner never resolves.
- Fix: Timeout → surface Retry button.

**R-L2. `co_engineer` header badge shows "Engineer" (identity ambiguity)**
- File: `src/components/DashboardLayout.tsx` (uses `effectiveRole`).
- Fix: Show original role label; only gate access via effective role.

---

## Priority summary — fix these first

1. **S-C1** — remove hardcoded tablet password from bundle + migrations.
2. **S-C2** — enable `verify_jwt` on all privileged admin edge functions.
3. **A-H2 / R-H1** — remove `tablet-signin` password auto-repair; stop direct `auth.users` writes.
4. **S-H1** — replace `USING (true)` policies on `line_production_baselines`, `rag_weekly_comments`, `sku_line_speeds`.
5. **S-C3** — hard-fail `intouch-webhook` when `WEBHOOK_SECRET` is unset.
6. **S-H3** — revoke `EXECUTE` from `public`/`anon` on all `SECURITY DEFINER` functions.

No code, DB, or deploy changes were made. This is diagnosis only — awaiting your go-ahead to implement any subset.
