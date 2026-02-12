

# AN Maintenance -- Professional Upgrade (Phase 1)

This plan covers the most impactful NEW features from the prompt. Many items are already implemented (roles, alerts, stock, analytics, sidebar, online panel, print, etc.). This phase focuses on the critical gaps.

---

## Already Implemented (no changes needed)

- Roles: Operator, Engineer, Manager with correct permissions
- WO creation with machine/problem dropdowns
- Engineer alerts (sound loop, web notification, toast)
- Stock management with categories, low stock alerts, FIFO
- Analytics page with KPIs, charts, engineer performance
- Work Orders page with filters, kanban, pagination, search
- Machines and Problems CRUD pages
- Online Engineers panel in header
- Print layout with logo, timeline, parts used
- Manager full control (edit/delete WOs, users, force close)
- Digital signature (name typed) before completing WO
- Live clock in header
- Notes/observations field on WOs

---

## NEW Features to Implement

### 1. Extended WO Status Pipeline

Current: `open -> in_progress -> completed | force_closed`

New: `open -> received -> arrived -> in_progress -> finished -> closed | force_closed`

**Database changes:**
- ALTER TYPE `wo_status` to add: `received`, `arrived`, `finished`, `closed`
- Add columns to `work_orders`: `received_at`, `arrived_at`, `finished_at`, `closed_at`
- The existing `completed_at` will map to `closed_at`; `finished_at` is when engineer finishes work

**Hook changes (`useWorkOrders.ts`):**
- Add `useReceiveWorkOrder` mutation (sets status=received, received_at=now)
- Add `useArriveWorkOrder` mutation (sets status=arrived, arrived_at=now)
- Rename `useStartWorkOrder` to set status=in_progress (already exists)
- Add `useFinishWorkOrder` mutation (sets status=finished, finished_at=now, requires signature)
- Add `useCloseWorkOrder` mutation (manager sets status=closed, closed_at=now)
- Update `WorkOrder` type with new fields

**Engineer Dashboard updates:**
- Show buttons in sequence: Receive -> Arrived -> Start -> Finish
- Each button only shows when the WO is in the correct previous status
- Signature dialog moves to Finish step (not complete)

**Work Orders Page updates:**
- Update status badges and kanban columns for new statuses
- Manager gets "Close" button on finished WOs (separate from force close)

**WO Detail updates:**
- Timeline shows all 6 timestamps
- Auto-calculate: response_time, travel_time, repair_time, total_time

### 2. SLA Priority System

**Database changes:**
- Add `priority` column to `work_orders` (text, default 'medium')
- Values: low, medium, high, critical
- SLA targets: low=120min, medium=60min, high=30min, critical=10min

**Operator Dashboard:**
- Add priority selector when creating WO (default: medium)

**Work Orders Page:**
- Priority badge (color-coded) in table and kanban cards
- Priority filter dropdown

**Engineer Dashboard:**
- Show SLA countdown timer on each open/received WO
- Red highlight when SLA is breached

**Analytics Page:**
- Replace "Parts Used by Category" with "SLA Compliance Rate" chart
- Replace "Top 5 Machines" with "Orders by Priority" chart

### 3. Audit Logs

**Database changes:**
- Create `audit_logs` table: id, user_id, user_name, action, entity_type, entity_id, details (jsonb), ip_address, created_at
- RLS: only admins can SELECT, insert via security definer function
- Create `log_audit_event` database function (security definer) that any authenticated user can call

**Logging points (client-side calls to log function):**
- WO created, edited, deleted, status changed
- User created, edited, deleted
- Machine/Problem created, edited, deleted
- Parts registered on WO
- WO printed

**Manager Dashboard:**
- Add "Audit Logs" to sidebar navigation
- New `AuditLogsPage.tsx` with searchable, filterable table

### 4. Updated Analytics Charts

Per the user's request, replace existing charts:
- Remove: "Parts Used by Category", "Top 5 Machines" (old format)
- Add: "Orders by Status" (pie/bar), "Lines with Most Problems", "Machines with Most Downtime", "SLA Compliance", "% Orders Without Parts"
- Keep: WOs per Day, Top 5 Problems, Engineer Performance

---

## Files to Create/Modify

| File | Action |
|------|--------|
| Migration SQL | Add wo_status values, new columns, audit_logs table, priority column |
| `src/hooks/useWorkOrders.ts` | New mutations (receive, arrive, finish, close), updated types |
| `src/hooks/useAuditLogs.ts` | NEW -- query and log audit events |
| `src/pages/dashboard/EngineerDashboard.tsx` | Sequential action buttons, SLA countdown |
| `src/pages/dashboard/OperatorDashboard.tsx` | Priority selector |
| `src/pages/dashboard/WorkOrdersPage.tsx` | New statuses, priority badges, close button |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Full 6-step timeline, calculated times |
| `src/pages/dashboard/AnalyticsPage.tsx` | New charts (SLA, downtime, status distribution) |
| `src/pages/dashboard/AuditLogsPage.tsx` | NEW -- audit log viewer |
| `src/components/DashboardLayout.tsx` | Add Audit Logs to sidebar |
| `src/App.tsx` | Add audit logs route |

---

## Implementation Sequence

1. Database migration (new statuses, columns, audit_logs table, priority)
2. Hooks (useWorkOrders updates, useAuditLogs)
3. Engineer Dashboard (sequential buttons + SLA countdown)
4. Operator Dashboard (priority selector)
5. Work Orders Page (new statuses + priority + close action)
6. WO Detail (full timeline + calculated metrics)
7. Analytics Page (new charts)
8. Audit Logs Page + sidebar/route

---

## Deferred to Phase 2

These features require significant additional infrastructure and will be addressed separately:
- Photo upload (before/after) -- requires storage bucket setup
- Maintenance checklist before finishing
- Machine history page with reliability score
- Control Center / factory map
- QR Code scanning (arrived/finished)
- Canvas-based signature drawing

