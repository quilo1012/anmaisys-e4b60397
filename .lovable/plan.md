

# CMMS Enterprise — Gap Analysis & Focused Implementation

## Coverage Assessment: ~95% Already Built

The system already implements the vast majority of these requirements. Here is what exists and what's missing:

### Already Implemented (No Changes Needed)
- RBAC with admin/engineer/operator, RLS policies, route protection
- WO lifecycle: open → received → arrived → in_progress → finished → closed/force_closed
- Machine tracking: type, location, code, status, health score, QR codes
- Location tracking with movement logs and auto-status sync trigger
- Combobox inputs for flexible machine type/location entry
- Shift management on profiles
- SLA tracking with countdown timers
- Engineer scoring system
- Analytics: MTTR, MTBF, downtime, failure heatmap, engineer ranking
- Audit logs with before/after values
- Button design system (Primary/Secondary/Danger/Ghost with loading states)
- Collapsible sidebar with icon-only mode and tooltips
- Print layout (A4, 20mm margins, audit-ready)
- Dark mode, responsive layout, lazy loading, debounce

### Actual Gaps to Implement

#### 1. Pause/Resume Time Tracking on Work Orders
**Problem:** WOs track start_time and finish_time but engineers cannot pause and resume work (e.g., waiting for parts).

**Database changes:**
- Add `paused_at` (timestamptz, nullable) column to `work_orders`
- Add `total_paused_minutes` (integer, default 0) column to `work_orders`
- New WO status value not needed — pause is a sub-state of `in_progress`

**Code changes:**
- `useWorkOrders.ts`: Add `usePauseWorkOrder` and `useResumeWorkOrder` mutation hooks
- `EngineerDashboard.tsx`: Add Pause/Resume toggle button on in_progress WOs, show elapsed active time (total minus paused)
- `WorkOrderDetail.tsx`: Display paused time in timeline and time tracking section

#### 2. Factory Visual Map with Drag-and-Drop
**Problem:** The Control Center shows machines grouped by line but lacks an interactive visual map with drag-and-drop relocation.

**Changes in `ControlCenterPage.tsx`:**
- Restructure layout to show factory zones as distinct visual areas (Lines, Storage, Maintenance Area) using a grid layout
- Machine cards use color coding: Green (active/in_use), Red (maintenance), Yellow (idle), Gray (available)
- Implement HTML5 drag-and-drop: dragging a machine card to a different zone triggers `useMoveMachine` and updates `current_location`
- Click on machine card opens a detail popover with status, last WO, health score, and link to history
- Auto-refresh via existing realtime subscription

#### 3. Machine Analytics by Type
**Problem:** Analytics page has machine downtime and failure charts but lacks filtering by machine type and WO-per-type breakdown.

**Changes in `AnalyticsPage.tsx`:**
- Add "WOs per Machine Type" bar chart (group WO count by machine type from machines table)
- Add machine type and shift filter dropdowns to the analytics filters section
- Add "Machine Status Distribution" pie chart (count by current status)

---

## Files Modified

| File | Change |
|------|--------|
| **DB Migration** | Add `paused_at` and `total_paused_minutes` to `work_orders` |
| `src/hooks/useWorkOrders.ts` | Add `usePauseWorkOrder`, `useResumeWorkOrder` hooks |
| `src/pages/dashboard/EngineerDashboard.tsx` | Pause/Resume button, active time display |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Show paused time in timeline |
| `src/pages/dashboard/ControlCenterPage.tsx` | Drag-and-drop factory map with zone layout |
| `src/pages/dashboard/AnalyticsPage.tsx` | WOs per machine type chart, status pie chart, type/shift filters |

## Sequence
1. Database migration (pause/resume columns)
2. Pause/Resume hooks and Engineer Dashboard UI
3. Factory Visual Map with drag-and-drop
4. Analytics enhancements (type charts, filters)

