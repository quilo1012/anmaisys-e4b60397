

# Phase 7: Audit Clear, AN- Numbering, Mobile Fix

## 1. Clear Audit Logs Button

**Database migration:** Add DELETE RLS policy on `audit_logs` for admin role.

**AuditLogsPage.tsx:** Add a "Clear Logs" button (admin only) with AlertDialog + PIN confirmation (reads PIN from `system_settings` table, same pattern as Clear WOs). Deletes all rows from `audit_logs`.

## 2. Work Order Numbering: AN-0001

**Database migration:** Reset the `wo_number_seq` sequence to start from 1 on next insert. Add a migration: `ALTER SEQUENCE wo_number_seq RESTART WITH 1;`

**All files displaying WO numbers** — replace `WO-{padStart(4)}` with `AN-{padStart(4)}`:
- `EngineerDashboard.tsx` (mobile card + table)
- `WorkOrdersPage.tsx` (table + kanban)
- `WorkOrderDetail.tsx`
- `OperatorDashboard.tsx`
- `ControlCenterPage.tsx` (if displayed)
- `generatePdfReport.ts`

## 3. Mobile Layout Fix (Top Cut Off)

The `DashboardLayout` header is `h-14` fixed but the main content starts with `p-6`. On mobile (390px viewport), the sidebar trigger + header can overlap content.

**Fix in `DashboardLayout.tsx`:**
- Add `pt-0` on mobile for the content area, ensure header doesn't overlap
- Change content padding from `p-6` to `p-4 md:p-6` for mobile breathing room

**Fix in `EngineerDashboard.tsx`:**
- Ensure the alert banner and KPI cards don't get cut off at the top on small viewports

---

## Files Modified

| File | Change |
|------|--------|
| Migration SQL | Add DELETE policy on audit_logs for admin; reset wo_number_seq |
| `AuditLogsPage.tsx` | Add Clear Logs button with PIN dialog |
| `DashboardLayout.tsx` | Fix mobile content padding |
| `EngineerDashboard.tsx` | AN- prefix, mobile spacing |
| `WorkOrdersPage.tsx` | AN- prefix |
| `WorkOrderDetail.tsx` | AN- prefix |
| `OperatorDashboard.tsx` | AN- prefix |
| `generatePdfReport.ts` | AN- prefix |

## Sequence
1. Database migration (audit_logs DELETE policy + sequence reset)
2. Clear Audit Logs button
3. AN- numbering across all files
4. Mobile layout fix

