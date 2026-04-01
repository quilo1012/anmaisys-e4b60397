

# Fix: `work_orders.engineer_id` FK Constraint Violation

## Root Cause

The foreign key `work_orders_engineer_id_fkey` references `profiles(id)` (auth users), but the PIN verification returns an `id` from the `engineers` table. These are completely different UUIDs — an engineer's PIN-verified ID will never exist in `profiles`.

## Fix

**Database migration**: Change the FK on `work_orders.engineer_id` from `profiles(id)` to `engineers(id)`.

```sql
ALTER TABLE work_orders DROP CONSTRAINT work_orders_engineer_id_fkey;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_engineer_id_fkey 
  FOREIGN KEY (engineer_id) REFERENCES engineers(id);
```

**No code changes needed** — the frontend already passes the correct `engineer_id` from PIN verification. The only problem is the FK pointing to the wrong table.

## Files Modified

| File | Change |
|------|--------|
| DB Migration | Re-point `work_orders.engineer_id` FK from `profiles` to `engineers` |

## Risk Check
- The `work_orders` select query joins `profiles` via `work_orders_engineer_id_fkey` for the `engineer` relation. After re-pointing, this join will fail since `engineer_id` now references `engineers`, not `profiles`.
- **Additional code fix** in `useWorkOrders.ts`: Change the select join from `engineer:profiles!work_orders_engineer_id_fkey(name)` to `engineer:engineers!work_orders_engineer_id_fkey(name)` in all queries that use it (main list query and `useWorkOrderById`).
- The `engineer_name` column on `work_orders` already stores the name directly, so the join is supplementary.

## Sequence
1. Database migration (drop old FK, add new FK to `engineers`)
2. Update select queries in `useWorkOrders.ts` to join `engineers` instead of `profiles`

