

# AN Maintenance System — Comprehensive Upgrade Plan

This is a very large request (~30+ discrete changes). I'll implement it in the exact order specified, organized into 5 steps.

---

## Step 1 — Add Admin Role (PART 1)

### Database
- Add `manager` to the `app_role` enum: `ALTER TYPE app_role ADD VALUE 'manager'`
- Currently only `admin`, `engineer`, `operator` exist. The system uses `admin` for managers. We need to add `manager` as a separate role so both can coexist.
- Set `daniel.quilo@appliednutrition.uk` to role `admin` (already is — verify and keep)

### Code Changes

**`src/components/ProtectedRoute.tsx`** — Add `manager` to `dashMap`, route managers to `/dashboard/manager`

**`src/App.tsx`** — Update all `allowedRoles` arrays: pages currently restricted to `["admin"]` should now allow `["admin", "manager"]` (except admin-only features)

**`src/components/DashboardLayout.tsx`** — Update `navItems` roles to include `manager`. Update header title logic. Add role badge colors.

**`src/contexts/AuthContext.tsx`** — No changes needed (role type comes from DB enum)

**`src/pages/users/ManageUsers.tsx`**:
- Add `manager` to `roleLabels` and `roleIcons`
- Add `Admin` option to role dropdown (only if current user is `admin`)
- Prevent managers from deleting manager/admin users (hide trash icon)
- Add role badge styling: grey=operator, blue=engineer, purple=manager, red=admin

**Edge functions** (`create-user`, `update-user`, `delete-user`):
- Update Zod schemas to accept `manager` role
- In `delete-user`: check if caller is admin when deleting manager/admin users

---

## Step 2 — Critical Bug Fixes (PART 2)

### 2.1 Seed Demo Data — Admin only
**`src/pages/dashboard/ManagerDashboard.tsx`** — Change `isPreview` check to also require `role === "admin"`

### 2.2 Clear WOs — Admin only + confirmation
**`src/pages/dashboard/WorkOrdersPage.tsx`** (or wherever Clear WOs lives) — Hide from managers, show only to admin. Add CONFIRM text input modal.

### 2.3 Clear Logs — Admin only + confirmation
**`src/pages/dashboard/AuditLogsPage.tsx`** — Same pattern as 2.2

### 2.4 Duplicate Avg MTTR card
**`src/pages/dashboard/ManagerDashboard.tsx`** — Replace 2nd "Avg MTTR" card (row 2, position 2) with "SLA Compliance %" card

### 2.5 Top Engineers showing "Unknown"
**`src/hooks/useEngineerScores.ts`** — Currently joins `profiles` table by `engineer_id`. But `engineer_scores.engineer_id` references `auth.users`, and engineer names are in the `engineers` table. Fix: also try joining `engineers` table when `profiles` returns no name.

### 2.6 Audit Logs not recording
**Multiple files** — The `logAuditEvent` function exists but is only called in a few places. Add calls to: `useWorkOrders` (create, status change, delete), `OperatorDashboard` (WO created), `ManageUsers` (user created/deleted), `MachinesPage` (edit), `StockPage` (adjust).

### 2.7 Auto-fill Requested By
**`src/pages/dashboard/OperatorDashboard.tsx`** — Set `requesterName` to `profile?.name` on mount. Make the input `readOnly`.

### 2.8 Manager can't delete Manager/Admin
**`src/pages/users/ManageUsers.tsx`** — Conditionally hide delete button when current user is manager and target is manager/admin.

---

## Step 3 — Sidebar & Navigation (PART 3)

### 3.1 Collapsible sidebar
Already implemented with `collapsible="icon"` and `SidebarProvider` cookie persistence. Verify it works correctly — may need minor fixes.

### 3.2 Group sidebar into sections
**`src/components/DashboardLayout.tsx`** — Restructure `navItems` into groups:
- **Operations**: Dashboard, Work Orders, Control Center
- **Assets**: Machines, Problems, Stock
- **Reports**: Analytics, Financial, Executive
- **Admin**: Users, Audit Logs

Render each group as a `SidebarGroup` with `SidebarGroupLabel`.

### 3.3 Role-based sidebar
Update the `roles` array on each nav item:
- Operator: Dashboard only
- Engineer: Dashboard, Stock
- Manager: All items
- Admin: All items

---

## Step 4 — Page UX Improvements (PART 4)

### 4.1 WO delete confirmation
**`src/pages/dashboard/WorkOrdersPage.tsx`** — Already has AlertDialog for delete. Verify it shows WO number.

### 4.2 Machines — search + filters
**`src/pages/dashboard/MachinesPage.tsx`** — Add search bar, Line/Status/Type filter dropdowns. Highlight missing fields in red during edit.

### 4.3 Problems — search + filters
**`src/pages/dashboard/ProblemsPage.tsx`** — Add search bar, Category/Risk/Active filter dropdowns.

### 4.4 Operator My WOs improvements
**`src/pages/dashboard/OperatorDashboard.tsx`** — Add time elapsed, assigned engineer name, color badges for status.

### 4.5 Engineer Dashboard — filters + sort
**`src/pages/dashboard/EngineerDashboard.tsx`** — Add Status/Line filter dropdowns. Default sort by SLA overdue.

### 4.6 Executive Dashboard — period selector
**`src/pages/dashboard/ExecutiveDashboard.tsx`** — Add period selector (7d, 30d, this month, 3mo, custom). Filter `workOrders` by selected period before computing KPIs.

### 4.7 Stock — movement history
**`src/pages/dashboard/StockPage.tsx`** — Add section below products table querying `parts_used` joined with `products` and `work_orders` to show movement history.

### 4.8 Notification bell
**`src/components/NotificationPanel.tsx`** — Already implemented with realtime subscriptions. Add low stock notification trigger for Manager/Admin.

---

## Step 5 — Financial Fix (PART 5)

### 5.1 Hourly rate
**`src/pages/users/ManageUsers.tsx`** — Add "Hourly Rate (£)" field in edit form for engineers. Save to `profiles.labor_rate`.

**`src/pages/dashboard/FinancialDashboard.tsx`** — Use `profiles.labor_rate` to calculate labor cost = hours worked × rate.

---

## Database Migration

```sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';
```

## Files Modified (summary)

| File | Key Changes |
|------|-------------|
| DB migration | Add `manager` to `app_role` enum |
| `src/App.tsx` | Update `allowedRoles` for manager |
| `src/components/ProtectedRoute.tsx` | Add manager to dashMap |
| `src/components/DashboardLayout.tsx` | Grouped sidebar, manager role support |
| `src/contexts/AuthContext.tsx` | No changes |
| `src/pages/users/ManageUsers.tsx` | Admin role UI, delete restrictions, hourly rate |
| `src/pages/dashboard/ManagerDashboard.tsx` | Fix duplicate MTTR, seed/clear admin-only |
| `src/pages/dashboard/AuditLogsPage.tsx` | Clear logs admin-only + confirmation |
| `src/pages/dashboard/WorkOrdersPage.tsx` | Clear WOs admin-only + confirmation |
| `src/hooks/useEngineerScores.ts` | Fix Unknown engineer names |
| `src/hooks/useAuditLogs.ts` | No changes (function already works) |
| Multiple pages | Add `logAuditEvent` calls |
| `src/pages/dashboard/OperatorDashboard.tsx` | Auto-fill requester, improve My WOs |
| `src/pages/dashboard/EngineerDashboard.tsx` | Filters, SLA sort |
| `src/pages/dashboard/ExecutiveDashboard.tsx` | Period selector |
| `src/pages/dashboard/MachinesPage.tsx` | Search + filters |
| `src/pages/dashboard/ProblemsPage.tsx` | Search + filters |
| `src/pages/dashboard/StockPage.tsx` | Movement history |
| `src/pages/dashboard/FinancialDashboard.tsx` | Labor cost calculation |
| `src/components/NotificationPanel.tsx` | Low stock alerts |
| Edge functions | Accept `manager` role |

Due to the size (~20+ files), I'll implement this in batches: Steps 1+2 first, then 3+4, then 5.

