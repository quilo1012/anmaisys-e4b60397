

# Performance & Reliability Enhancements

## What's Already Implemented (No Changes Needed)
- **Realtime subscriptions** — `useWorkOrders` already subscribes to `postgres_changes` on `work_orders` (line 75-84)
- **Alert system** — `useWOAlerts` handles new WO alerts for engineers; `usePredictiveAlerts` flags recurring failures (≥3 in 30 days)
- **Lazy loading + Skeletons** — All dashboard routes use `lazy()` with `Skeleton` loader
- **Audit/traceability** — `logAuditEvent` + `work_order_logs` track engineer_id, timestamps, actions
- **Persistent sessions** — Supabase client already has `persistSession: true`, `autoRefreshToken: true`
- **Error handling** — Mutations use try/catch patterns with toast notifications
- **Analytics (MTTR, downtime)** — AnalyticsPage already calculates MTTR, MTBF, downtime, SLA compliance

## Changes to Implement

### 1. Auto-Refresh Fallback (`src/hooks/useWorkOrders.ts`)
Add `refetchInterval: 30_000` to the `useWorkOrders` query as a fallback when realtime fails.

### 2. Optimistic UI for Accept+Start (`src/hooks/useWorkOrders.ts`)
Add `onMutate` to `useAcceptAndStartWorkOrder` that immediately updates the cached WO status to `in_progress` using `queryClient.setQueryData`, and add `onError` rollback with `queryClient.setQueryData` restoring the previous data.

### 3. Image Compression Before Upload (`src/hooks/useWOPhotos.ts`)
Add a `compressImage` utility function that uses canvas to resize images to max 1920px and compress to JPEG quality 0.7 (targeting ~1MB). Call it in `useUploadWOPhoto` before the storage upload.

### 4. Work Orders Pagination (`src/hooks/useWorkOrders.ts`)
Add `.limit(200)` to the main `useWorkOrders` query to prevent loading thousands of records. The `useWorkOrderById` query is unaffected.

### 5. Offline Detection Hook (`src/hooks/useOfflineQueue.ts`) — NEW FILE
Create a simple hook that:
- Tracks `navigator.onLine` state via event listeners
- Shows a toast when going offline/online
- Exposes `isOnline` boolean for UI indicators

### 6. Loading States & Button Disabling (`src/pages/dashboard/EngineerDashboard.tsx`)
Add `disabled={acceptAndStartWO.isPending}` to the Accept+Start button (and similar for Finish). Show `<Loader2>` spinner while pending.

### 7. Database Indexes (Migration)
Add indexes on `work_orders` for common query patterns:
```sql
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_engineer_id ON work_orders(engineer_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_operator_id ON work_orders(operator_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_created_at ON work_orders(created_at DESC);
```

---

## Summary of File Changes

| File | Change |
|------|--------|
| `src/hooks/useWorkOrders.ts` | Add refetchInterval, optimistic update for accept+start, .limit(200) |
| `src/hooks/useWOPhotos.ts` | Add image compression before upload |
| `src/hooks/useOfflineQueue.ts` | New file — offline detection hook |
| `src/pages/dashboard/EngineerDashboard.tsx` | Button disable states during mutations |
| `src/components/DashboardLayout.tsx` | Show offline indicator banner |
| Migration SQL | Add indexes on work_orders |

