

# AN Maintenance — 5-Section Upgrade Plan

## Section 1: Role Permissions — Admin vs Manager Separation

### Sidebar
**`src/components/DashboardLayout.tsx`** line 52-53: Change `roles` for Users and Audit Logs from `["admin", "manager"]` to `["admin"]` only. This hides the Admin section from managers.

### Route protection
**`src/App.tsx`**: Change `allowedRoles` for:
- `/users/manage` → `["admin"]` (was `["admin", "manager"]`)
- `/dashboard/audit-logs` → `["admin"]` (was `["admin", "manager"]`)

This ensures direct URL access redirects managers to their dashboard.

### Clear buttons
Already correct — `WorkOrdersPage.tsx` line 255 and `AuditLogsPage.tsx` line 72 both check `role === "admin"`.

---

## Section 2: Audit Logging — Extend Coverage

Most WO mutations in `useWorkOrders.ts` already call `logAuditEvent`. Missing events to add:

| Event | File | Details |
|-------|------|---------|
| User created | `ManageUsers.tsx` `handleCreateUser` | `{ name, email, role }` |
| User role changed | `ManageUsers.tsx` `handleEditUser` | `{ name, email, old_role, new_role }` |
| User deleted | `ManageUsers.tsx` `handleDeleteUser` | `{ name, email }` |
| Clear WOs | `WorkOrdersPage.tsx` clear handler | `{ cleared_by }` |
| Clear Logs | `AuditLogsPage.tsx` `handleClearLogs` | `{ cleared_by }` |
| PIN changed | `ManageUsers.tsx` engineer PIN | `{ engineer_name }` |

WO create, accept, status change already log via `useWorkOrders.ts`. Login already logs via `Login.tsx`. Will verify and add missing calls.

---

## Section 3: Collapsible Sidebar

The sidebar already uses `collapsible="icon"` with `SidebarProvider` which handles cookie-based persistence and the trigger button. The current implementation already:
- Collapses to icon-only mode
- Shows tooltips when collapsed
- Persists state

Minor improvements needed:
- **`src/components/DashboardLayout.tsx`**: Add `transition-all duration-200` to main content area for smooth resize
- Verify user name/role area collapses properly (already has `group-data-[collapsible=icon]:hidden` classes)

---

## Section 4: Downtime Module — New Page

### Database
Create `downtime` table with columns: id, line, machine, reason, category, started_at, ended_at, reported_by, work_order_id, notes, created_at. Use a validation trigger instead of CHECK constraint for category. Enable RLS with admin/manager full access, engineer/operator read.

### New files
- **`src/hooks/useDowntime.ts`** — CRUD hooks using react-query + supabase
- **`src/pages/dashboard/DowntimePage.tsx`** — Full page with:
  - 4 KPI cards (Total Downtime Today, Active Stoppages, Avg Duration, Most Affected Line)
  - Register Downtime button → modal form
  - Table with filters (Line, Category, Date, Status)
  - Edit, Mark Resolved, Delete actions

### Integration
- **`src/App.tsx`**: Add route `/dashboard/downtime` with `allowedRoles: ["admin", "manager"]`
- **`src/components/DashboardLayout.tsx`**: Add "Downtime" nav item in Operations group with `Clock` icon
- **`src/pages/dashboard/ExecutiveDashboard.tsx`**: Update "Downtime Today" KPI to query real downtime table

---

## Section 5: UX Improvements

### 5a. Dashboard title for Admin
**`src/pages/dashboard/ManagerDashboard.tsx`** line 104: Change from hardcoded "Manager Dashboard" to `{role === "admin" ? "Admin" : "Manager"} Dashboard`.

### 5b. Live timer on Engineer active WOs
**`src/pages/dashboard/EngineerDashboard.tsx`**: Add a `LiveTimer` component that shows elapsed time since `started_at` for `in_progress` WOs, updating every 60 seconds via `setInterval`.

### 5c. Color-coded WO status badges
Already implemented — `statusConfig` in both `WorkOrdersPage.tsx` and `EngineerDashboard.tsx` maps statuses to colors (blue=open, amber=in_progress, green=completed, grey=force_closed).

### 5d. Browser tab titles
**`src/components/DashboardLayout.tsx`**: Add a `useEffect` that sets `document.title` based on the current route using `useLocation()`. Format: `"AN Maintenance | {Page Name}"`.

### 5e. Quick Actions row on Manager/Admin Dashboard
**`src/pages/dashboard/ManagerDashboard.tsx`**: Add a row of 3 buttons between KPI cards and Quick Links:
- "+ New Work Order" (blue, opens create WO dialog)
- "View Open WOs" (links to `/dashboard/work-orders?status=open`)
- "Control Center" (links to `/dashboard/control-center`)

---

## Files Modified Summary

| File | Changes |
|------|---------|
| DB migration | Create `downtime` table + RLS policies |
| `src/App.tsx` | Restrict audit/users routes to admin, add downtime route |
| `src/components/DashboardLayout.tsx` | Admin-only sidebar items, downtime nav, browser tab titles, transition |
| `src/pages/dashboard/ManagerDashboard.tsx` | Dynamic title, quick actions row |
| `src/pages/dashboard/EngineerDashboard.tsx` | Live timer component |
| `src/pages/users/ManageUsers.tsx` | Add audit log calls for user CRUD |
| `src/pages/dashboard/AuditLogsPage.tsx` | Add audit log on clear |
| `src/pages/dashboard/WorkOrdersPage.tsx` | Add audit log on clear WOs |
| `src/pages/dashboard/ExecutiveDashboard.tsx` | Real downtime data |
| `src/hooks/useDowntime.ts` | New — downtime CRUD hooks |
| `src/pages/dashboard/DowntimePage.tsx` | New — full downtime page |

Implementation will proceed in order: permissions → audit → sidebar → downtime → UX.

