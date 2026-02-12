

# Dashboard Restructure -- Complete Implementation Plan

This is a major restructuring that separates the monolithic Manager Dashboard into dedicated pages with proper sidebar navigation, new modules, and enhanced analytics.

## Overview of Changes

The current Manager Dashboard (~800 lines) will be split into 7 dedicated pages/modules, the sidebar will be restructured with proper navigation sections, and new features will be added including an online engineers panel and engineer performance analytics.

---

## Phase 1: Sidebar Restructuring

**File:** `src/components/DashboardLayout.tsx`

Restructure the sidebar navigation to include all modules as dedicated menu items instead of header buttons:

```text
Navigation (admin):
  - Dashboard (overview KPIs)
  - Analytics (charts only)
  - Work Orders (table + kanban)
  - Machines (CRUD page)
  - Problems (CRUD page)
  - Stock
  - Users
```

Navigation items will be role-filtered as before. The header will contain only: page title, live clock, and online engineers panel (for admin).

Remove Machines/Problems buttons from the Manager Dashboard header since they become sidebar pages.

---

## Phase 2: New Pages and Routes

### A) Analytics Page (NEW)
**File:** `src/pages/dashboard/AnalyticsPage.tsx`
**Route:** `/dashboard/analytics` (admin only)

Contains ONLY charts and KPIs extracted from ManagerDashboard:
- KPI cards (Open WOs, In Progress, Completed Today, Total Users, Avg Response, Avg MTTR, Parts Today, Low Stock)
- WOs per Day chart (last 7 days)
- Top 5 Machines chart
- Top 5 Problems chart
- Parts Used by Category chart
- **NEW: Engineer Performance chart** -- bar chart showing per-engineer: total completed, avg response time, avg MTTR

No tables on this page.

### B) Work Orders Page (refactored from ManagerDashboard)
**File:** `src/pages/dashboard/WorkOrdersPage.tsx`
**Route:** `/dashboard/work-orders` (admin only)

Contains ONLY the work orders table/kanban (extracted from ManagerDashboard):
- Table/Board toggle
- All filters (search, status, problem, machine, date)
- Pagination
- Create/Edit/Delete WO dialogs
- Print button per row
- Export CSV

No charts on this page.

### C) Machines Page (NEW)
**File:** `src/pages/dashboard/MachinesPage.tsx`
**Route:** `/dashboard/machines` (admin only)

Full-page CRUD for machines (currently a dialog inside ManagerDashboard):
- Table showing all machines with columns: Name, Line, Sector, Code, Status
- Add machine form
- Edit machine (inline or dialog)
- Delete machine with confirmation

**Database:** Add columns to `machines` table:
- `line` (text, default '')
- `sector` (text, default '')
- `code` (text, default '')
- `status` (text, default 'active')

### D) Problems Page (NEW)
**File:** `src/pages/dashboard/ProblemsPage.tsx`
**Route:** `/dashboard/problems` (admin only)

Full-page CRUD for problem descriptions (currently a dialog inside ManagerDashboard):
- Table showing all problems with columns: Name, Category, Severity, Description, Active
- Add/Edit/Delete problem
- Active toggle

**Database:** Add columns to `problem_descriptions` table:
- `category` (text, default '')
- `severity` (text, default 'medium')
- `description` (text, default '')
- `active` (boolean, default true)

### E) Manager Dashboard (simplified)
**File:** `src/pages/dashboard/ManagerDashboard.tsx` (rewrite)
**Route:** `/dashboard/manager`

Simplified overview page with just KPI summary cards and quick links to Analytics, Work Orders, etc. Acts as landing page.

---

## Phase 3: Online Engineers Panel

**File:** `src/components/OnlineEngineersPanel.tsx`

Display in the header (admin view only):
- Green dot for online engineers
- Name display
- Count of online engineers
- Real-time updates via Supabase Realtime on `profiles` table

**Mechanism:** Track engineer online status using a `last_seen_at` timestamp on the `profiles` table. Engineers update this every 30 seconds via a heartbeat. Engineers with `last_seen_at` within last 60 seconds are "online".

**Database:** Add column to `profiles` table:
- `last_seen_at` (timestamp with time zone, nullable)

**File:** `src/hooks/useOnlineEngineers.ts` -- query engineers with recent `last_seen_at`
**File:** `src/hooks/useHeartbeat.ts` -- engineer heartbeat every 30s

---

## Phase 4: Engineer Performance Analytics

Added to the Analytics page:
- Query all completed WOs grouped by engineer
- Calculate per-engineer: total completed, avg response, avg MTTR
- Display as horizontal bar chart

No database changes needed -- derived from existing `work_orders` data.

---

## Phase 5: Enhanced Machines and Problems Tables

### Machines Hook Update
**File:** `src/hooks/useMachines.ts`
- Update `Machine` interface with new fields (line, sector, code, status)
- Add `useUpdateMachine` mutation

### Problems Hook Update
**File:** `src/hooks/useProblemDescriptions.ts`
- Update `ProblemDescription` interface with new fields (category, severity, description, active)
- Add `useUpdateProblemDescription` mutation
- Filter only active problems in WO creation dropdowns

---

## Phase 6: Route Updates

**File:** `src/App.tsx`

Add new routes:
```text
/dashboard/analytics    -> AnalyticsPage (admin)
/dashboard/work-orders  -> WorkOrdersPage (admin)
/dashboard/machines     -> MachinesPage (admin)
/dashboard/problems     -> ProblemsPage (admin)
```

---

## Database Migrations

### Migration 1: Machines table enhancement
```sql
ALTER TABLE public.machines ADD COLUMN line text DEFAULT '';
ALTER TABLE public.machines ADD COLUMN sector text DEFAULT '';
ALTER TABLE public.machines ADD COLUMN code text DEFAULT '';
ALTER TABLE public.machines ADD COLUMN status text DEFAULT 'active';
```

### Migration 2: Problem descriptions enhancement
```sql
ALTER TABLE public.problem_descriptions ADD COLUMN category text DEFAULT '';
ALTER TABLE public.problem_descriptions ADD COLUMN severity text DEFAULT 'medium';
ALTER TABLE public.problem_descriptions ADD COLUMN description text DEFAULT '';
ALTER TABLE public.problem_descriptions ADD COLUMN active boolean DEFAULT true;
```

### Migration 3: Online engineer tracking
```sql
ALTER TABLE public.profiles ADD COLUMN last_seen_at timestamptz;
```

---

## Files Summary

| File | Action |
|------|--------|
| `src/App.tsx` | Add 4 new routes |
| `src/components/DashboardLayout.tsx` | Restructure sidebar with all nav items |
| `src/components/OnlineEngineersPanel.tsx` | NEW -- online engineers indicator |
| `src/hooks/useOnlineEngineers.ts` | NEW -- query online engineers |
| `src/hooks/useHeartbeat.ts` | NEW -- engineer heartbeat |
| `src/hooks/useMachines.ts` | Add update mutation + new fields |
| `src/hooks/useProblemDescriptions.ts` | Add update mutation + new fields |
| `src/pages/dashboard/ManagerDashboard.tsx` | Simplify to overview only |
| `src/pages/dashboard/AnalyticsPage.tsx` | NEW -- charts + KPIs + engineer performance |
| `src/pages/dashboard/WorkOrdersPage.tsx` | NEW -- table/kanban + filters |
| `src/pages/dashboard/MachinesPage.tsx` | NEW -- full CRUD for machines |
| `src/pages/dashboard/ProblemsPage.tsx` | NEW -- full CRUD for problems |
| 3 SQL migrations | Schema changes |

---

## Implementation Order

1. Database migrations (machines, problems, profiles)
2. Hooks updates (useMachines, useProblemDescriptions, useOnlineEngineers, useHeartbeat)
3. OnlineEngineersPanel component
4. DashboardLayout sidebar restructure
5. New pages (Analytics, WorkOrders, Machines, Problems)
6. ManagerDashboard simplification
7. App.tsx route updates

