
# Fix: Stock Reduction Trigger + Parts Used Visibility on Dashboards

## Critical Bug: Stock Not Decreasing

The database function `reduce_stock_on_parts_used()` exists but **no trigger is attached** to the `parts_used` table. This means when an engineer registers parts, the stock quantity never decreases.

**Fix**: Create the missing database trigger that fires AFTER INSERT on `parts_used`, calling the existing `reduce_stock_on_parts_used()` function.

```sql
CREATE TRIGGER trg_reduce_stock_on_parts_used
  AFTER INSERT ON parts_used
  FOR EACH ROW
  EXECUTE FUNCTION reduce_stock_on_parts_used();
```

## Dashboard and WO Detail: Show Parts Used Consistently

Currently, parts used are only visible on the Work Order Detail page. The Manager Dashboard and Engineer Dashboard WO tables do not show parts information.

**Changes**:
- Add a "Parts" column to the Manager Dashboard WO table showing the count of parts used per WO (fetched via a summary query or inline display).
- The Engineer Dashboard already has a "Parts" button for in-progress WOs -- add a parts count badge next to completed WOs too.
- Ensure the Work Order Detail page continues to show the full parts table (already working).

Since fetching parts count per WO individually would be expensive (N+1 queries), a better approach is to add a summary hook that fetches parts counts for all visible WOs in one query, or show parts info only when clicking into the WO detail (which already works). The most practical approach: add a "Parts" column in both dashboard tables that shows a clickable count linking to the WO detail.

**Implementation**: Use a single query to get parts counts grouped by `work_order_id` for all displayed WOs, then show the count in the table.

---

## Technical Details

### Database Migration

```sql
-- Create the missing trigger for automatic stock reduction
CREATE TRIGGER trg_reduce_stock_on_parts_used
  AFTER INSERT ON parts_used
  FOR EACH ROW
  EXECUTE FUNCTION reduce_stock_on_parts_used();
```

### New Hook: `usePartsCountByWOs`

Add a hook in `src/hooks/useStock.ts` that fetches parts counts grouped by work order:

```typescript
// Fetches { work_order_id, total_qty } for a set of WO IDs
usePartsCountByWOs(woIds: string[])
```

This uses a single query: `select work_order_id, sum(quantity) from parts_used where work_order_id in (...) group by work_order_id`.

### Files to Modify

| File | Change |
|------|--------|
| Database | Add trigger `trg_reduce_stock_on_parts_used` |
| `src/hooks/useStock.ts` | Add `usePartsCountByWOs` hook |
| `src/pages/dashboard/ManagerDashboard.tsx` | Add "Parts" column showing count per WO |
| `src/pages/dashboard/EngineerDashboard.tsx` | Add "Parts" column showing count per WO |
| `src/pages/dashboard/WorkOrderDetail.tsx` | No changes needed (already shows parts) |

### Summary

1. **Trigger fix** -- stock will now correctly decrease when engineer registers parts
2. **Parts count on dashboards** -- both Manager and Engineer tables will show how many parts were used per WO
3. **Consistent view** -- clicking the WO number still navigates to the detail page with full parts table
