

# Bug Fixes Plan

## Status Assessment

| Bug | Status | Action Needed |
|-----|--------|--------------|
| 1. Duplicate MTTR | ✅ Already fixed | None |
| 2. Seed Demo Data | ⚠️ Partially fixed | Remove completely (currently shows for admin in preview) |
| 3. Clear WOs confirmation | ⚠️ Has CONFIRM modal but PIN check is broken | Fix PIN verification to use edge function |
| 4. Clear Logs confirmation | ✅ Already fixed | None |
| 5. Top Engineers "Unknown" | ✅ Already fixed | None (verified: engineers table returns real names) |
| 6. Audit Logs not recording | ⚠️ WO events are logged but login is not | Add login audit event |
| 7. Requested By auto-fill | ✅ Already fixed | None |
| 8. Stale WO badge | ❌ Not implemented | Add stale badge + filter |
| 9. Daniel as admin | ✅ Already done | None |

## Changes to implement (4 items)

### Fix 1: Remove Seed Demo Data button entirely
**File:** `src/pages/dashboard/ManagerDashboard.tsx`
- Remove the `isPreview` variable, `seeding` state, and `handleSeedDemo` function
- Remove the Seed Demo Data button from the JSX (lines 135-140)

### Fix 2: Fix Clear WOs broken PIN verification
**File:** `src/pages/dashboard/WorkOrdersPage.tsx` (lines 560-585)
- The current code fetches `admin_pin` (bcrypt hash) and compares it with plain text — always fails
- Replace with `supabase.functions.invoke("verify-admin-pin", { body: { pin: clearPin } })` (same pattern used in AuditLogsPage)

### Fix 3: Add login audit event
**File:** `src/pages/Login.tsx`
- After successful login, call `logAuditEvent("login", "user")` to record the event
- Since `auth.uid()` may not be available immediately in the RPC after login, we may need to add a small delay or call it after the session is established

### Fix 4: Add "Stale WO" badge for WOs overdue >72h
**Files:** `src/pages/dashboard/EngineerDashboard.tsx`, `src/pages/dashboard/WorkOrdersPage.tsx`
- For WOs with status `in_progress` where `started_at` is more than 72 hours ago, show an orange "Stale WO" badge with a tooltip: "This work order has been in progress for more than 3 days. Consider reviewing or closing it."
- In WorkOrdersPage, add a "Stale (>72h)" option to the status filter dropdown

## Technical details

- No database migrations needed
- No RLS changes needed
- All changes are UI-level fixes

