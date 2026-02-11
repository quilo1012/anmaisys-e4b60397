

# Phase 2 -- Work Orders System (Full Implementation)

This phase implements the complete Work Order lifecycle: Operators create WOs, Engineers receive real-time alerts and execute them, and Managers have full oversight. It also adds the WO detail page and navigation updates.

---

## 1. Database Changes

### New enum: `wo_status`
```
'open', 'in_progress', 'completed', 'force_closed'
```

### New table: `work_orders`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | auto-generated |
| line | text | production line |
| machine | text | machine name |
| description | text | problem description |
| status | wo_status | default 'open' |
| operator_id | uuid | who created it (references profiles) |
| engineer_id | uuid (nullable) | who is executing |
| closed_by | uuid (nullable) | manager who force-closed |
| notified_engineers | text[] | array of engineer IDs notified |
| created_at | timestamptz | auto |
| started_at | timestamptz (nullable) | when engineer started |
| completed_at | timestamptz (nullable) | when finished |

### RLS Policies for `work_orders`
- **Operators**: SELECT own WOs only (`operator_id = auth.uid()`); INSERT with `operator_id = auth.uid()`
- **Engineers**: SELECT all WOs; UPDATE (start/complete WOs assigned to them)
- **Managers (admin)**: SELECT all; UPDATE all (force-close); no direct INSERT needed

### Enable Realtime
- Add `work_orders` to `supabase_realtime` publication for live engineer notifications

---

## 2. New Pages and Components

### Operator Dashboard (`/dashboard/operator`)
- **Create WO form**: Line (text input), Machine (text input), Problem Description (textarea)
- **My Work Orders table**: lists only WOs created by the logged-in operator with status badges (Open = blue, In Progress = amber, Completed = green, Force Closed = gray)
- Auto-refreshes via Realtime subscription so operator sees status changes live

### Engineer Dashboard (`/dashboard/engineer`)
- **Open WOs list**: all WOs with status "open" or "in_progress"
- **Action buttons**: "Start" (sets status to in_progress, assigns engineer_id, records started_at), "Complete" (sets status to completed, records completed_at)
- **Real-time alert system**:
  - Subscribe to `work_orders` INSERT events via Supabase Realtime
  - Check if current engineer's shift matches current time of day
  - Play audio notification (generated programmatically using Web Audio API -- no external file needed)
  - Show toast notification with WO details and quick-action button
- **Stats cards**: WOs completed today, average response time

### Manager Dashboard (`/dashboard/manager`)
- **KPI cards** (live data): Open WOs count, In Progress count, Completed today, total users
- **All Work Orders table**: filterable by status, shows operator name, engineer name, timestamps
- **Force Close button** on any open/in-progress WO

### WO Detail Page (`/dashboard/wo/:id`)
- Full WO information: line, machine, description, status with colored badge
- Timeline of events: created, started, completed/force-closed with timestamps
- Duration calculations (response time, total time)
- Placeholder for "Parts Used" section (Phase 3)

---

## 3. Route Updates (App.tsx)

Add new route:
- `/dashboard/wo/:id` -- accessible by all authenticated roles (operator can see own, engineer can see assigned, manager can see all)

---

## 4. Sidebar Navigation Updates

Update `DashboardLayout.tsx` nav items:
- Operator gets: Dashboard, (no separate WO link since dashboard IS their WO view)
- Engineer gets: Dashboard, Work Orders (separate list view)
- Manager gets: Dashboard, Work Orders, Stock (Phase 3 placeholder), Users

---

## 5. Real-Time Alert Logic (Engineer)

```text
New WO inserted (Realtime subscription)
  --> Check: Is engineer logged in? (yes, they're on the page)
  --> Check: Does engineer's shift match current time?
       Morning: 06:00-14:00
       Afternoon: 14:00-22:00
       Night: 22:00-06:00
  --> If match:
       - Play alert sound (Web Audio API beep)
       - Show toast with WO summary
       - Update notified_engineers array on the WO
```

---

## Technical Details

### Files to create:
- `src/pages/dashboard/WorkOrderDetail.tsx` -- WO detail page
- `src/hooks/useWorkOrders.ts` -- shared hook for WO queries/mutations
- `src/hooks/useWOAlerts.ts` -- real-time alert hook for engineers
- `src/lib/shifts.ts` -- shift time matching utility

### Files to modify:
- `src/App.tsx` -- add WO detail route
- `src/components/DashboardLayout.tsx` -- update nav items
- `src/pages/dashboard/OperatorDashboard.tsx` -- full create WO + list implementation
- `src/pages/dashboard/EngineerDashboard.tsx` -- full WO execution + alerts
- `src/pages/dashboard/ManagerDashboard.tsx` -- live KPIs + all WOs table + force close

### Database migration:
- Create `wo_status` enum
- Create `work_orders` table with RLS
- Enable realtime on `work_orders`

