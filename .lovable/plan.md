

# CMMS Enterprise Polish — Gap Analysis & Implementation Plan

## Current Coverage: ~92%

The system already has: RBAC (admin/engineer/operator), full WO pipeline, SLA tracking, checklists, audit logs, dark mode, notifications, print layout, analytics, executive dashboard, financial dashboard, stock, realtime, responsive layout, lazy loading, and more.

## Remaining Gaps to Fix

### 1. Print Layout — Professional Document Quality
The current print CSS works but needs refinement to match enterprise document standards:
- **Header "Manager Dashboard"** still visible in print (the `<header>` element in DashboardLayout)
- **Signature section** needs proper spacing with lines for physical signatures
- **@page margin**: currently 8mm, spec asks 20mm — use 15mm as compromise for A4 fit
- **Print-only footer**: add "AN Maintenance — Confidential" + page reference
- **WorkOrderDetail**: ensure the print header has clean logo + "Work Order" title + date layout without overlap

**Files:** `src/index.css`, `src/pages/dashboard/WorkOrderDetail.tsx`

### 2. Button Consistency — Loading States on All Mutations
Several action buttons don't show loading spinners during API calls:
- Force Close, Close, Delete buttons in `WorkOrdersPage.tsx` fire mutations without disabling/showing spinner inline
- Edit dialog Save button already has spinner — good
- Ensure all destructive actions have confirmation modals (Force Close currently lacks a confirmation modal)

**Files:** `src/pages/dashboard/WorkOrdersPage.tsx`

### 3. Force Close Confirmation Modal
The spec requires Force Action = Admin only + confirmation modal + audit log. Currently Force Close fires directly without a confirmation dialog. Add an `AlertDialog` confirmation before executing `forceClose.mutate()`.

**File:** `src/pages/dashboard/WorkOrdersPage.tsx`

### 4. Empty States Polish
Add proper empty state illustrations/messages for:
- Work Orders table (already has basic text — enhance with icon)
- Parts Used section (already has text)
- Photos section (already handled)
- Audit Logs (check current state)

**Files:** `src/pages/dashboard/WorkOrdersPage.tsx`, `src/pages/dashboard/AuditLogsPage.tsx`

### 5. WorkOrdersPage — Print Header Visibility
The `print-header` div has class `hidden` but should show in print. Fix to `hidden print:block`.

**File:** `src/pages/dashboard/WorkOrdersPage.tsx`

---

## Files Modified

| File | Change |
|------|--------|
| `src/index.css` | Refine print margins, ensure header/sidebar hidden, add print footer |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Polish print signature section, ensure clean document layout |
| `src/pages/dashboard/WorkOrdersPage.tsx` | Force Close confirmation modal, loading states on action buttons, print header fix, enhanced empty state |
| `src/pages/dashboard/AuditLogsPage.tsx` | Enhanced empty state with icon |

## Sequence
1. Print CSS refinements (index.css + WorkOrderDetail)
2. Force Close confirmation modal (WorkOrdersPage)
3. Button loading states + empty states polish

