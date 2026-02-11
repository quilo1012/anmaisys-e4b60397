

# Fix: Duplicate Stock Trigger + Dashboard Consistency + Parts Visibility

## Critical Bug Found: Stock Reduced TWICE

The database has **two triggers** on `parts_used` that both call `reduce_stock_on_parts_used()`:
- `trg_reduce_stock` (pre-existing)
- `trg_reduce_stock_on_parts_used` (just added)

Every time an engineer registers parts, the stock quantity is reduced **double**. For example, if 2 parts are used, 4 are subtracted from stock.

**Fix**: Drop the duplicate trigger `trg_reduce_stock` and keep only `trg_reduce_stock_on_parts_used`.

## Dashboard Consistency: Add Parts Column to Operator Dashboard

The Manager and Engineer dashboards already show a "Parts" column with badge counts. The Operator dashboard is missing this column. Add it for consistency so operators can also see how many parts were used on their orders.

## Summary of Changes

### Database Migration
```sql
DROP TRIGGER IF EXISTS trg_reduce_stock ON parts_used;
```

### Files to Modify

| File | Change |
|------|--------|
| Database | Drop duplicate trigger `trg_reduce_stock` |
| `src/pages/dashboard/OperatorDashboard.tsx` | Add "Parts" column with count badge (same pattern as Manager/Engineer dashboards) |

### What's Already Working
- Parts used display on WO Detail page (full table with product name, code, qty, engineer, date)
- Parts count badges on Manager and Engineer dashboard tables
- Stock reduction trigger (once we fix the duplicate)
- Real-time stock updates when engineer registers parts
- Parts Used dialog for engineers to register parts during in-progress WOs

