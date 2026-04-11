

# Implementation Plan: Multi-Fix Changes

## Overview
This plan covers 4 areas: remove required field validation, persistent login, operator signature + sidebar + hide checklist + notifications, and company logo placement.

---

## 1. Remove Required Field Validation (Make Fields Optional)

### `src/pages/dashboard/OperatorDashboard.tsx`
- **Line 88**: Remove the validation check `if (!requestedBy.trim() || !machine.trim() || !description.trim())` — allow submission with empty fields
- **Line 92-94**: Remove the retroactive date/time validation block (allow partial retroactive data)

### `src/pages/Login.tsx`
- Keep `required` on login fields (email/password) — these are authentication fields, not data entry. Removing would break login.

### `src/pages/dashboard/WorkOrdersPage.tsx`
- The create WO handler (line 195) uses `.trim()` but has no explicit validation block — no change needed.

---

## 2. Persistent Login (No Auto Logout)

### `src/integrations/supabase/client.ts`
- **Cannot edit** (auto-generated). Already has `persistSession: true` and `autoRefreshToken: true`.
- No inactivity logout logic exists in the codebase (confirmed by search). Session is already persistent.
- **No changes needed** — the app already keeps users logged in until they click Sign Out.

---

## 3A. Operator Signature on Finished WOs

### Database Migration
- Add `operator_signature_name` column (text, nullable) to `work_orders` table.

### `src/pages/dashboard/OperatorDashboard.tsx`
- In the "My Work Orders" table, add a "Close" action button for WOs with status `finished`.
- Clicking opens a dialog with a text input for operator name (digital signature).
- On confirm: calls `useCloseWorkOrder` (modified) to set `status = "closed"`, `closed_at = now()`, `operator_signature_name`, and `closed_by`.
- Button disabled if signature field is empty.

### `src/hooks/useWorkOrders.ts`
- Modify `useCloseWorkOrder` to accept `{ woId, signatureName }` instead of just `woId`.
- Update mutation to set `operator_signature_name` in the update payload.

---

## 3B. Sidebar Tablet Fix

### `src/components/DashboardLayout.tsx`
- Change the outer flex container (line 189) from `min-h-screen` to `h-screen overflow-hidden`.
- Change the main area (line 217) to `flex-1 flex flex-col overflow-hidden`.
- Change the content div (line 236) to include `overflow-y-auto flex-1`.

---

## 3C. Remove Checklist (Temporary — Hide UI Only)

### `src/pages/dashboard/EngineerDashboard.tsx`
- Remove/comment out `InlineChecklist` rendering in `MobileWOCard` (line 378).
- Remove/comment out `DesktopInlineChecklist` rendering (line 606).
- Make `useChecklistComplete` always return `true` (line 149) so Finish button is never blocked by checklist.

### `src/pages/dashboard/WorkOrderDetail.tsx`
- Wrap the Checklist card section (lines 365-396) in a condition that always evaluates to `false`, e.g., `{false && checklistItems && ...}`.

---

## 3D. Engineer Notification (Already Implemented)

- The `useWOAlerts` hook already subscribes to `INSERT` events on `work_orders` and plays an alert sound + sends web notification + shows toast for all engineers when a new WO is created.
- The `NotificationPanel` component already shows in-app notifications for new WOs.
- **No changes needed** — this feature already exists.

---

## 4. Company Logo (App Icon + Header)

### Already Implemented
- **Favicon**: `index.html` already references the Applied Nutrition logo as favicon.
- **Header logo**: `DashboardLayout.tsx` line 192 already shows `appliedLogo` in the sidebar header.
- **Login page**: `Login.tsx` line 60-63 already shows the logo above the form at 120px height, centered.
- **No changes needed** — logos are already in place everywhere requested.

---

## Summary of Actual Changes

| Area | Files Changed |
|------|--------------|
| Remove required validation | `OperatorDashboard.tsx` |
| Operator signature to close WO | Migration + `OperatorDashboard.tsx` + `useWorkOrders.ts` |
| Sidebar tablet fix | `DashboardLayout.tsx` |
| Hide checklist UI | `EngineerDashboard.tsx` + `WorkOrderDetail.tsx` |
| Persistent login | None (already implemented) |
| Engineer notifications | None (already implemented) |
| Company logo | None (already implemented) |

