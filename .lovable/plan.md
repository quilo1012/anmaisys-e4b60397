## Problem

Two header/KPI metrics are showing stale data even though the underlying work orders are closed:

1. **"43 lines stopped"** — confirmed in DB: 43 work orders have `line_stopped = true` and `line_resumed_at = NULL`, but their status is `force_closed`. The badge query in `useStoppedLinesCount` only looks at those two flags and ignores the WO status, so terminal orders keep counting.
2. **"Avg Response Time = 849 min"** — `v_wo_metrics` is returning very large `response_time_sec` values for `force_closed` orders (avg 759 min, max 2784 min) because they were force-closed without an engineer ever accepting, so the response window is computed against `closed_at`/`now()`. Those rows shouldn't count toward the response-time average.

## Fix

### 1. `src/hooks/useStoppedLinesCount.ts`
Add a status filter so we only count orders that are still active:
```ts
.eq("line_stopped", true)
.is("line_resumed_at", null)
.not("status", "in", "(closed,finished,completed,force_closed)")
```

### 2. One-time data cleanup migration
Backfill the 43 stuck rows so historic reports are also clean:
```sql
UPDATE public.work_orders
SET line_resumed_at = COALESCE(closed_at, finished_at, completed_at, now()),
    line_stopped = false
WHERE line_stopped = true
  AND line_resumed_at IS NULL
  AND status IN ('closed','finished','completed','force_closed');
```

### 3. Exclude force-closed WOs from response-time averages
In `ExecutiveDashboard.tsx` (and the same pattern in `AnalyticsPage.tsx` / `EngineerDashboard.tsx` where applicable), filter out force-closed rows when computing `avgResponse` and `avgMTTR`, since they distort the average:
```ts
const respMetrics = woMetrics.filter(
  (m) => m.response_time_sec !== null && m.status !== "force_closed"
);
```
Same treatment for `active_repair_sec` (MTTR).

No UI/visual changes — purely metric correctness.

## Verification

- Header badge should disappear (0 active stopped lines).
- Executive Dashboard "Avg Response Time" and "Avg Active Repair" should drop to realistic values reflecting only normally-completed WOs.

## Question

Do you also want the **Avg Active Repair (MTTR)** and the Analytics page averages to exclude `force_closed` orders (recommended for consistency), or only the header/Executive cards?