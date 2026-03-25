

# AN Maintenance -- Professional Upgrade (Phase 2: New Features)

## Already Implemented (no work needed)

All of these are confirmed working in the codebase:
- Full 6-step WO pipeline (open → received → arrived → in_progress → finished → closed)
- SLA countdown with priority targets (low/med/high/critical)
- Engineer alerts (sound loop, web notification, toast, stops on received)
- Stock management with categories, low stock alerts, zero-stock block
- Analytics page with KPIs, status/priority/problem/machine charts, engineer performance
- Machines and Problems CRUD pages
- Sidebar with all modules, Online Engineers panel, Live clock
- Digital signature (name) before finishing WO
- Audit logging on all mutations
- Print layout with logo, timeline, parts, signature
- Role-based permissions (operator/engineer/admin)
- Realtime subscriptions on work_orders
- Lazy loading, skeletons, QueryClient caching

---

## NEW Features to Implement

### 1. Manager Receives WO Alerts (like Engineers)

Currently `useWOAlerts` only activates for `role === "engineer"`. The prompt requires managers to also receive alerts.

**File:** `src/hooks/useWOAlerts.ts`
- Change `role !== "engineer"` checks to `role !== "engineer" && role !== "admin"`
- Manager gets same sound, notification, toast on new WO

### 2. Photo Upload (Before/After) -- Storage Bucket + UI

Create a storage bucket for WO photos and add upload UI to the engineer finish flow.

**Database migration:**
```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('wo-photos', 'wo-photos', true);
-- RLS: engineers and admins can upload/view
CREATE POLICY "Engineers can upload photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'wo-photos' AND (has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role)));
CREATE POLICY "Anyone authenticated can view photos" ON storage.objects FOR SELECT USING (bucket_id = 'wo-photos');
```

**New table** `wo_photos`:
```sql
CREATE TABLE public.wo_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL,
  photo_type text NOT NULL CHECK (photo_type IN ('before', 'after')),
  storage_path text NOT NULL,
  uploaded_by uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.wo_photos ENABLE ROW LEVEL SECURITY;
-- Policies for engineer insert + admin/engineer select
```

**UI changes:**
- `src/pages/dashboard/EngineerDashboard.tsx`: Add photo upload buttons (before/after) in the in_progress state, require both before allowing "Finish"
- `src/pages/dashboard/WorkOrderDetail.tsx`: Display uploaded photos in the detail view
- New hook: `src/hooks/useWOPhotos.ts`

### 3. Maintenance Checklist Before Finishing

**Database migration:**
Add `checklist_completed` boolean column to `work_orders` (default false).

**UI changes:**
- `src/pages/dashboard/EngineerDashboard.tsx`: Before the sign dialog, show a checklist dialog with 4 items (machine off, energy lockout, inspection done, final test). All must be checked before proceeding to signature.
- Block "Finish" button until checklist is completed

### 4. Machine History Page with Reliability Score

**New file:** `src/pages/dashboard/MachineHistoryPage.tsx`
**Route:** `/dashboard/machines/:name/history`

Contents:
- List of all WOs for this machine
- Parts used on this machine
- Total downtime calculation (sum of repair_time for all WOs)
- Reliability Score = 100 - (downtime_minutes / total_period_minutes * 100)
- Visual indicator: green (>80), yellow (50-80), red (<50)
- Failure frequency chart

**Files:**
- `src/App.tsx`: Add route
- `src/pages/dashboard/MachinesPage.tsx`: Add "History" link per machine row
- `src/components/DashboardLayout.tsx`: No sidebar change needed (accessed from Machines page)

### 5. Control Center -- Factory Map

**New file:** `src/pages/dashboard/ControlCenterPage.tsx`
**Route:** `/dashboard/control-center`

- Visual grid of all machines grouped by line/sector
- Color-coded: green (no open WOs), yellow (WO open but received), red (WO open unattended)
- Realtime updates via existing work_orders subscription
- Click machine to see active WO or navigate to history

**Files:**
- `src/App.tsx`: Add route
- `src/components/DashboardLayout.tsx`: Add "Control Center" to sidebar nav for admin

### 6. Downtime Chart in Analytics

**File:** `src/pages/dashboard/AnalyticsPage.tsx`
- Add "Machines with Most Downtime" chart: sum repair_time per machine, show top 10 as horizontal bar chart
- Remove or keep existing charts as-is (all are useful, none redundant)

---

## Files Summary

| File | Action |
|------|--------|
| Migration SQL | wo_photos table, storage bucket, checklist_completed column |
| `src/hooks/useWOAlerts.ts` | Add admin role to alert listeners |
| `src/hooks/useWOPhotos.ts` | NEW -- upload/query WO photos |
| `src/pages/dashboard/EngineerDashboard.tsx` | Photo upload + checklist dialog before finish |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Display photos |
| `src/pages/dashboard/MachineHistoryPage.tsx` | NEW -- machine history + reliability score |
| `src/pages/dashboard/ControlCenterPage.tsx` | NEW -- factory map |
| `src/pages/dashboard/AnalyticsPage.tsx` | Add downtime chart |
| `src/pages/dashboard/MachinesPage.tsx` | Add history link |
| `src/components/DashboardLayout.tsx` | Add Control Center to sidebar |
| `src/App.tsx` | Add 2 new routes |

## Implementation Sequence

1. Database migration (wo_photos table, storage bucket, checklist column)
2. useWOAlerts -- add admin support
3. useWOPhotos hook
4. Engineer Dashboard -- checklist + photo upload + finish flow
5. WorkOrderDetail -- display photos
6. Analytics -- downtime chart
7. Machine History page + route
8. Control Center page + route + sidebar

