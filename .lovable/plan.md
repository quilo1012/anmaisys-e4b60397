

# Fix: High-Priority CMMS/MES Issues

## 1. Parts Used — Engineer Name (WorkOrderDetail.tsx)

**Current**: Line 323 shows `pu.engineer?.name || wo.engineer_name || ""`. The join `engineer:profiles!parts_used_engineer_id_fkey(name)` is correct and should resolve the real name from the `profiles` table. However, the RLS on `profiles` SELECT only lets engineers see other engineers, and admins see all. If the profile query silently fails, it falls back to `wo.engineer_name`.

**Fix**: The fallback chain is actually correct. The real issue is that `pu.engineer?.name` may return null for non-admin viewers due to RLS. Keep the current fallback but also use `wo.engineer_name` as secondary. No code change needed here — this already works.

**Verified**: No change needed.

## 2. Work Order Detail — Print Isolation (WorkOrderDetail.tsx)

**Current**: The `DashboardLayout` wraps the entire page, which includes the sidebar, header bar, etc. The header already has `print:hidden` (line 169 of DashboardLayout). The Back/Print buttons already have `print:hidden` (line 201). Screen-only title has `print:hidden` (line 211).

**Issue**: The `DashboardLayout` wrapper is fine for screen but adds structure. The print CSS already hides sidebar/header. This is already handled correctly. No change needed.

## 3. Work Order Timing Fields (WorkOrderDetail.tsx)

**Current** (lines 155-160):
- Response Time: `received_at - created_at` — but the standard definition is time until first engineer acknowledgment. This is correct.
- Travel Time: `arrived_at - received_at` — correct.
- Repair Time: `(finished_at || completed_at) - started_at - total_paused_minutes` — correct.
- Total Time: `(closed_at || completed_at) - created_at` — correct.

**Issue**: When `received_at` is null (e.g. if Accept+Start skips intermediate steps), Response Time shows blank. The `useAcceptAndStartWorkOrder` sets `received_at`, `arrived_at`, and `started_at` all at once. So timing should be populated. If a WO only has `started_at` but not `received_at`, response time shows blank which is misleading.

**Fix**: Use `started_at` as fallback for response time when `received_at` is null:
```
const responseTime = wo.received_at 
  ? differenceInMinutes(new Date(wo.received_at), new Date(wo.created_at)) 
  : wo.started_at 
    ? differenceInMinutes(new Date(wo.started_at), new Date(wo.created_at)) 
    : null;
```

Similarly for travel time, if `arrived_at` is null but `started_at` exists, show 0 or skip.

## 4. Protected Route — Already Fixed

The previous approved fix already addresses this. `ProtectedRoute.tsx` and `AuthContext.tsx` handle role loading, token refresh, and access denied correctly. No change needed.

## 5. Checklist Consistency

**Current**: `InlineChecklist` (line 56) uses `useChecklistsByProblemName(wo.description)` which matches checklist items by problem name. If no items exist, it returns null (line 60). This is correct — no static fallback.

**Verified**: No change needed.

## 6. Master Data Quality

### Problems Page (ProblemsPage.tsx)
**Current**: Only `name` is required (line 158: `if (!name.trim()) return`). Category, description are optional.

**Fix**: Add validation warnings (not hard blocks) for missing category and description. Show a visual indicator in the table for incomplete records.

### Machines Page (MachinesPage.tsx)
**Current**: Already validates name, type, and location as required (lines 58-60). Code is optional but checked for duplicates. This is already good.

**Verified**: Machines validation is already solid. Only Problems needs improvement.

## 7. Analytics Polish (AnalyticsPage.tsx)

**Issues**:
- Line 181: `wo.engineer?.name || "Unknown"` — this joins `engineers` table, not `profiles`. Should use `wo.engineer_name || wo.engineer?.name || "Unknown"` to prefer the stored name.
- Chart labels on horizontal bar charts may get cut off when machine names are long. The `width={120}` on YAxis is fixed.
- Pie chart labels overlap when many statuses exist.

**Fixes**:
- Use `wo.engineer_name` first in engineer performance calculation
- Increase YAxis width to 140 and add `tick={{ fontSize: 11 }}` for readability
- Add `labelLine={false}` to pie charts and use percentage labels instead of names (names shown in legend)

## 8. Manager Dashboard Polish (ManagerDashboard.tsx)

**Current**: "Seed Demo Data" button is visible in preview (line 132-136). 

**Fix**: No change — the button is already gated by `isPreview` which checks for lovable.app/localhost domains. This is the intended behavior for review/testing context.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/pages/dashboard/WorkOrderDetail.tsx` | Fix response/travel time fallbacks for Accept+Start WOs |
| `src/pages/dashboard/AnalyticsPage.tsx` | Use `engineer_name` field; improve chart label sizing; fix pie chart overlap |
| `src/pages/dashboard/ProblemsPage.tsx` | Add validation hints for incomplete category/description |

