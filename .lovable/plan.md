
# Fix Plan: Machine Validation, WO Delete, Reliability Filters

## Issue 1: Machine Form — All Fields Required
**Root cause**: `validate()` in `MachinesPage.tsx` (line 56-68) requires name, machineType, currentLocation, AND code. Should only require name.

**Fix** (`src/pages/dashboard/MachinesPage.tsx`):
- Remove required validation for `machineType`, `currentLocation`, and `code`
- Keep only `name` as required
- Remove the duplicate code check (keep it optional)
- Update form labels to remove `*` from non-required fields

## Issue 2: Admin Cannot Delete Work Orders
**Root cause**: DB error: `parts_used_work_order_id_fkey` and `downtime_work_order_id_fkey` block deletion because they lack `ON DELETE CASCADE`. When a WO has parts_used or downtime records, the FK constraint prevents deletion.

**Fix** (DB migration):
```sql
ALTER TABLE parts_used DROP CONSTRAINT parts_used_work_order_id_fkey;
ALTER TABLE parts_used ADD CONSTRAINT parts_used_work_order_id_fkey 
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;

ALTER TABLE downtime DROP CONSTRAINT downtime_work_order_id_fkey;
ALTER TABLE downtime ADD CONSTRAINT downtime_work_order_id_fkey 
  FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;
```

Also delete related records from tables without FK (wo_messages, checklist_responses, machine_events) before deleting the WO itself in `useDeleteWorkOrder`.

## Issue 3: Reliability Dashboard Not Showing Today's Orders
**Root cause**: `endDate` is initialized as `new Date()` at component mount time. Orders created after that instant are excluded by `d > endDate`. The comparison doesn't include the full day.

**Fix** (`src/pages/dashboard/ReliabilityDashboard.tsx`):
- Set endDate to end-of-day: use `endOfDay(new Date())` from date-fns
- In the filter, use `endOfDay(endDate)` for the comparison so the entire selected end date is included

## Files Changed
| File | Change |
|------|--------|
| `src/pages/dashboard/MachinesPage.tsx` | Remove required validation for type/location/code |
| `src/hooks/useWorkOrders.ts` | Delete related records before WO deletion |
| `src/pages/dashboard/ReliabilityDashboard.tsx` | Fix endDate to include full day |
| Migration SQL | Add ON DELETE CASCADE to parts_used and downtime FKs |
