

# Machine Tracking (Asset Tracking) Enhancement

## Current State

The `machines` table already has: `name`, `line`, `sector`, `code`, `status`, `health_score`. The MachinesPage supports CRUD, and MachineHistoryPage shows WO history, reliability, and failure charts. The ControlCenterPage groups machines by line.

**What's missing:** `machine_type`, `current_location`, `last_maintenance_date` columns; location transfer logging; status auto-update from WOs; enhanced detail page; QR code support.

## Plan

### Phase 1: Database Migration

Add 3 new columns to `machines` table:
- `machine_type` (text, default `''`) — Sealer, Printer, Labeler, etc.
- `current_location` (text, default `''`) — Line A, Storage, Maintenance Area, etc.
- `last_maintenance_date` (timestamptz, nullable)

Create new `machine_location_log` table to track location changes:
- `id` (uuid, PK)
- `machine_id` (uuid, NOT NULL)
- `from_location` (text)
- `to_location` (text, NOT NULL)
- `moved_by` (uuid) — user who moved it
- `created_at` (timestamptz, default now())
- RLS: admins full access, engineers SELECT

Create a trigger on `work_orders` to auto-update machine status:
- When WO status becomes `open`/`in_progress` → set machine status to `maintenance`
- When WO status becomes `closed`/`finished` → set machine status to `active` (if no other open WOs for that machine)
- Update `last_maintenance_date` on WO close

### Phase 2: Update MachinesPage

Add new form fields: Machine Type (select), Current Location (select), and display them in the table.

Add a "Move" action button per machine row that opens a dialog to change location — logs the move in `machine_location_log` and updates `current_location`.

Show `last_maintenance_date` in the table.

### Phase 3: Enhanced Machine Detail Page (MachineHistoryPage)

Add tabs or sections:
- **Overview**: Current status, location, type, line, health score, last maintenance
- **Location History**: Table from `machine_location_log` showing all moves
- **Work Orders**: Existing WO history (already built)
- **Failure Chart**: Already built

### Phase 4: WO Integration

Update the WO creation form (OperatorDashboard, WorkOrdersPage) to show machine's current location when a machine is selected.

### Phase 5: Analytics Enhancements

Add to AnalyticsPage:
- **Most Used Machines**: machines with highest WO count
- **Maintenance Frequency**: avg WOs per machine per month
- These partially exist (downtime by machine chart) — enhance with new metrics

### Phase 6: QR Code (Optional, High Value)

Add QR code generation per machine on MachinesPage (using a lightweight QR library). QR encodes a URL like `/dashboard/machines/:name/history` or a direct "Create WO" link.

---

## Files Modified

| File | Change |
|------|--------|
| **DB Migration** | Add columns to `machines`, create `machine_location_log`, create auto-status trigger |
| `src/hooks/useMachines.ts` | Update Machine interface, add location log hooks |
| `src/pages/dashboard/MachinesPage.tsx` | New form fields (type, location), Move action, last maintenance display |
| `src/pages/dashboard/MachineHistoryPage.tsx` | Location history tab, enhanced overview section |
| `src/pages/dashboard/OperatorDashboard.tsx` | Show machine location on WO creation |
| `src/pages/dashboard/AnalyticsPage.tsx` | Most used machines, maintenance frequency metrics |

## Sequence
1. Database migration (columns + location log table + trigger)
2. Update hooks and Machine interface
3. MachinesPage enhancements (type, location, move action)
4. MachineHistoryPage with location history
5. WO integration and analytics
6. QR code generation

