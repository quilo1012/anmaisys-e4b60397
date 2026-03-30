

# Assessment: Current System vs Request

Your system **already implements ~85%** of this specification. Here is a precise gap analysis and plan for the remaining features.

## Already Built (No Changes Needed)

- WO pipeline with full status workflow (open → received → arrived → in_progress → finished → closed + force_closed)
- Role-based access (admin/engineer/operator) with RLS and route protection
- WO auto-numbering, priority, SLA tracking with countdown timers
- Checklists (pre/post service), parts used, photo attachments
- Analytics dashboard (MTTR, response time, SLA compliance, charts)
- Executive dashboard (strategic KPIs, TV mode)
- Financial dashboard (cost tracking, admin-only)
- Audit log system with PIN-protected clear
- Realtime alerts with industrial sounds and browser notifications
- Chat per work order (realtime)
- Sidebar navigation (collapsible, role-filtered)
- Print/PDF export optimized for A4
- Stock management with low-stock alerts
- Machine management with Health Score
- Engineer ranking and scoring system
- Mobile responsive layout
- Loading skeletons, empty states, toast notifications
- Control Center (TV mode)
- Lazy loading, debounced search, query caching

## What's Missing — Implementation Plan

### Phase A: Dark Mode Toggle

**Files:** `src/index.css` (dark variables already exist), `src/components/DashboardLayout.tsx`

- Dark CSS variables are already defined but no toggle exists
- Add a Sun/Moon toggle button in the header bar
- Store preference in `localStorage`
- Apply `.dark` class to `<html>` element

### Phase B: Advanced Table Features (WorkOrdersPage)

**File:** `src/pages/dashboard/WorkOrdersPage.tsx`

- **Column visibility toggle:** Add a dropdown with checkboxes to show/hide columns
- **Line filter:** Add a "Line" filter dropdown (extract unique lines from machines)
- **Clickable links:** WO number already navigates to detail; add machine click → `/dashboard/machines/:name/history`, requester/engineer click → tooltip with profile info (no separate user profile page exists)

### Phase C: Notification Panel

**Files:** New `src/components/NotificationPanel.tsx`, `src/components/DashboardLayout.tsx`

- Add a bell icon in the header with badge count
- Dropdown panel showing recent notifications (new WO, assignment, overdue, completed)
- Store notifications in-memory (from existing realtime subscriptions)
- Mark as read functionality
- Complements existing toast notifications

### Phase D: MTBF Metric

**File:** `src/pages/dashboard/AnalyticsPage.tsx`

- Calculate Mean Time Between Failures per machine
- Add MTBF KPI card alongside existing MTTR
- Formula: total operational time / number of failures per machine

### Phase E: Before/After Audit Values

**File:** `src/hooks/useWorkOrders.ts`, audit log calls

- Enhance `logAuditEvent` calls to include `before` and `after` values in the `details` JSON for status changes and edits
- Display diff in `AuditLogsPage.tsx` details column

---

## Files Modified

| File | Change |
|------|--------|
| `src/components/DashboardLayout.tsx` | Dark mode toggle, notification bell |
| `src/index.css` | Minor dark mode polish |
| `src/components/NotificationPanel.tsx` | NEW — notification dropdown |
| `src/pages/dashboard/WorkOrdersPage.tsx` | Column visibility, clickable links |
| `src/pages/dashboard/AnalyticsPage.tsx` | MTBF metric |
| `src/hooks/useWorkOrders.ts` | Before/after audit values |
| `src/pages/dashboard/AuditLogsPage.tsx` | Display before/after diff |

## Sequence

1. Dark mode toggle (quick win, high visual impact)
2. Notification panel
3. Advanced table features
4. MTBF metric
5. Audit before/after values

