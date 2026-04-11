

# Fix 8 Issues — AN Maintenance

## Summary

8 fixes targeting security (PIN validation), UI (print layout, checklist defaults), and UX (error messages, retroactive orders, print headers).

## Root Cause Analysis

**FIX 1 (Critical PIN bypass):** The `AlertDialogAction` component from Radix UI automatically closes the dialog on click, which may interfere with the async PIN verification. Additionally, the edge function may need redeployment. The DB function `verify_admin_pin` works correctly (verified: returns `true` for '1234', `false` for '9999'). The fix: replace `AlertDialogAction` with a regular `Button` to prevent auto-close, and ensure the edge function is redeployed.

**FIX 3 (Checklist Required):** Line 44 in ProblemsPage: `useState(true)` — must be `useState(false)`. Also line 56-57 resets to `Safety`/`true` after add — must reset to `""`/`false`.

## Changes

### 1. Edge Function `verify-admin-pin` — Redeploy + return 200 for invalid PIN

**File: `supabase/functions/verify-admin-pin/index.ts`**
- Change line 81: return `status: 200` instead of `status: 401` for invalid PIN (so `pinRes.ok` is true and we rely on `valid: false` in body)
- This prevents `fetch` from treating invalid PIN as a network error

### 2. AuditLogsPage — Fix AlertDialogAction auto-close + error toast

**File: `src/pages/dashboard/AuditLogsPage.tsx`**
- Replace `AlertDialogAction` with regular `Button` (prevents auto-close on click)
- The existing toast for invalid PIN already exists (line 55) — ensure it fires by fixing the dialog auto-close issue
- Add `setConfirmText("")` on error to let user retry

### 3. WorkOrdersPage — Error toast visibility

**File: `src/pages/dashboard/WorkOrdersPage.tsx`**
- Already uses regular `Button` (line 572) — good
- Toast already exists (line 588) — verify it shows. The issue may be the 401 status. Fix by matching the edge function change (200 for invalid)

### 4. ProblemsPage — Checklist defaults

**File: `src/pages/dashboard/ProblemsPage.tsx`**
- Line 44: `useState(true)` → `useState(false)`
- Line 56: `setNewType("Safety")` → `setNewType("")`
- Line 57: `setNewRequired(true)` → `setNewRequired(false)`

### 5. Print CSS — Remove browser headers/footers + hide sidebar

**File: `src/index.css`**
- Change `@page { margin: 10mm; }` → `@page { margin: 0; }`
- Add `body { padding: 12mm !important; }` in `@media print`
- Add comprehensive sidebar hiding selectors targeting `[data-sidebar]`, Shadcn sidebar wrapper classes
- Ensure `main` and `#root` expand to full width

### 6. DashboardLayout — print:hidden on sidebar

**File: `src/components/DashboardLayout.tsx`**
- Add `print:hidden` class to the `<Sidebar>` component wrapper
- The header already has `print:hidden` (line 218) — confirmed

### 7. AnalyticsPage — Print header

**File: `src/pages/dashboard/AnalyticsPage.tsx`**
- Add a `hidden print:block` header matching WorkOrderDetail style (logo, "AN MAINTENANCE", "ANALYTICS REPORT", period dates, print timestamp)
- Already has `print:hidden` on filter controls (line 257) — confirmed

### 8. WorkOrderDetail — Print header logo verification

**File: `src/pages/dashboard/WorkOrderDetail.tsx`**
- Already uses `appliedLogo` from `@/assets/appliedlogo.jpeg` (same as login page) — confirmed working
- No changes needed

### 9. OperatorDashboard — Requested By + Retroactive

**File: `src/pages/dashboard/OperatorDashboard.tsx`**
- Already implemented correctly: `requesterName` state with `profile?.name` fallback, retroactive toggle with date/time pickers
- Add validation: if retroactive is on but date/time empty, show error toast
- Ensure `requester_name` in submit uses `profile?.name` as primary (not editable state)

## Files to modify

| File | Change |
|------|--------|
| `supabase/functions/verify-admin-pin/index.ts` | Return 200 (not 401) for invalid PIN |
| `src/pages/dashboard/AuditLogsPage.tsx` | Replace AlertDialogAction with Button; fix auto-close |
| `src/pages/dashboard/WorkOrdersPage.tsx` | Minor: ensure error toast works with 200 response |
| `src/pages/dashboard/ProblemsPage.tsx` | `newRequired` default `false`, reset to `""` / `false` |
| `src/index.css` | `@page { margin: 0 }`, sidebar print hiding, body padding |
| `src/components/DashboardLayout.tsx` | Add `print:hidden` to Sidebar |
| `src/pages/dashboard/AnalyticsPage.tsx` | Add print header with logo and report title |
| `src/pages/dashboard/OperatorDashboard.tsx` | Add retroactive validation on submit |

One edge function deployment needed: `verify-admin-pin`.
No database migrations needed.

