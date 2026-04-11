

# Comprehensive Enhancement Plan: RBAC, Reliability, Predictive Intelligence & Smart UX

## What Already Exists (No Changes Needed)
- **RBAC & Route Protection**: ProtectedRoute + sidebar role filtering already working
- **Sidebar collapse**: Already collapsible with icon mode + localStorage persistence
- **Sidebar tablet layout**: Already fixed with `h-screen overflow-hidden`
- **Predictive alerts**: `usePredictiveAlerts` already detects ≥3 occurrences in 30 days
- **Machine history page**: Already exists at `/dashboard/machines/:name/history`
- **Operator smart suggestions**: Already shows recent WOs + top problems per machine
- **Print layout fix**: Already applied

---

## Changes to Implement

### Phase 1: Database — Migration

Create `machine_events` table + add indexes:

```sql
CREATE TABLE public.machine_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid REFERENCES machines(id) ON DELETE SET NULL,
  work_order_id uuid,
  problem_description text,
  action_taken text,
  part_used text,
  event_type text NOT NULL DEFAULT 'repair',
  engineer_id uuid,
  engineer_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.machine_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view machine_events" ON public.machine_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Engineers can insert machine_events" ON public.machine_events FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'engineer') OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'));

CREATE INDEX idx_machine_events_machine_id ON machine_events(machine_id);
CREATE INDEX idx_machine_events_created_at ON machine_events(created_at DESC);
```

### Phase 2: RBAC Expansion — Engineer Access

**`src/components/DashboardLayout.tsx`** — Add engineer access to more sidebar items:
- Downtime: add `"engineer"` to roles
- Analytics: add `"engineer"` to roles
- Add new "Reliability" item for `["admin", "engineer"]`

**`src/App.tsx`** — Update route permissions:
- `/dashboard/analytics`: add `"engineer"`
- `/dashboard/downtime`: add `"engineer"`
- Add `/dashboard/reliability` route for `["admin", "engineer"]`

### Phase 3: Machine Events Hook — `src/hooks/useMachineEvents.ts` (NEW)

- `useMachineEvents(machineId?)` — fetch events for a machine
- `useCreateMachineEvent()` — insert event on WO finish
- Integration in `useFinishWorkOrder` to auto-create a machine_event

### Phase 4: Predictive Intelligence Enhancement — `src/hooks/usePredictiveAlerts.ts`

Enhance existing hook to add:
- **Recurring detection**: same problem ≥3 times in **7 days** (tighter window)
- **MTBF calculation**: average time between failures per machine
- **MTBF warning**: if current gap ≈ MTBF, flag it
- **Recent repair alert**: if last repair < 5 days ago
- **Risk scoring**: LOW / MEDIUM / HIGH per machine

### Phase 5: Auto Priority — `src/pages/dashboard/OperatorDashboard.tsx`

When creating a WO:
- Check if machine+problem is recurring → set HIGH
- Check if machine had recent repair → set HIGH
- Check if repeated issues → set MEDIUM
- Default → LOW
- Show inline alert: "Recurring issue detected (X times this week)"

### Phase 6: Reliability Dashboard — `src/pages/dashboard/ReliabilityDashboard.tsx` (NEW)

Full page at `/dashboard/reliability` with:
- **KPI cards**: Total machines, Total WOs (30d), Total downtime, Avg MTTR, Avg MTBF
- **Machine risk table**: machine, failures, downtime, MTTR, MTBF, risk badge, last failure — sorted HIGH first
- **Top 5 Problem Machines** bar chart
- **Most Common Problems** bar chart
- **Failure Trend** (30-day) line/bar chart
- **Machine detail expandable**: last 10 events from `machine_events`
- **Filters**: date range, machine, line

### Phase 7: AI Insights on WO Creation — `src/pages/dashboard/OperatorDashboard.tsx`

When machine is selected, show an insights card:
- Similar past problems + occurrence count (already partially done via `machineSuggestions`)
- Add "Suggested cause" and "Suggested action" text from predictive alerts
- Show recurring warning badge

---

## Summary of File Changes

| File | Change |
|------|--------|
| Migration SQL | Create `machine_events` table + RLS + indexes |
| `src/hooks/useMachineEvents.ts` | NEW — CRUD for machine_events |
| `src/hooks/usePredictiveAlerts.ts` | Enhance with MTBF, risk scoring, 7-day recurring, recent repair |
| `src/hooks/useWorkOrders.ts` | Auto-create machine_event on finish |
| `src/components/DashboardLayout.tsx` | Add engineer to downtime/analytics sidebar, add Reliability nav item |
| `src/App.tsx` | Add reliability route, expand engineer access to analytics/downtime |
| `src/pages/dashboard/ReliabilityDashboard.tsx` | NEW — Full reliability dashboard page |
| `src/pages/dashboard/OperatorDashboard.tsx` | Auto-priority + AI insights card on WO creation |

