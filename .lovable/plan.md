

User wants to replace any remaining manual duration math on the Analytics page with values from `v_wo_metrics`. Let me check the current state of AnalyticsPage.tsx — the previous fix already swapped `avgResponse`, `avgMTTR`, and downtime aggregations to `useAllWoMetrics`, but there may still be inline `differenceInMinutes` / `differenceInSeconds` calls that survived.

The user mentions an `elapsed_minutes` field — that field does NOT exist in our `v_wo_metrics` view. The view exposes second-based fields: `line_downtime_sec`, `reporting_delay_sec`, `response_time_sec`, `travel_time_sec`, `active_repair_sec`, `restart_delay_sec`, `paperwork_delay_sec`, `total_cycle_sec`. I'll convert seconds → minutes (`/60`) where the UI needs minutes, and call this out in the plan so the user knows we're using `total_cycle_sec` (the closest equivalent to "elapsed minutes" — full lifecycle duration) rather than inventing a non-existent column.

Let me inspect AnalyticsPage to find leftover manual calculations.
<lov-tool-use id="toolu_vrtx_019soFKgk8GdRVxRExSUZof6" name="code--view" integration-id="code" data="{\"file_path\": \"src/pages/dashboard/AnalyticsPage.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01WyUFwEqL3em18L3A8HkhTD" name="code--search_files" integration-id="code" data="{\"query\": \"differenceIn|getTime\\\\(\\\\)|new Date\\\\(.*\\\\) -\", \"include_patterns\": \"src/pages/dashboard/AnalyticsPage.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01BBEioTnD5VaoVdSFc7iG8a" name="code--view" integration-id="code" data="{\"file_path\": \"src/pages/dashboard/AnalyticsPage.tsx\"}">
</lov-tool-use>
Note: the user mentions an `elapsed_minutes` field on `v_wo_metrics`, but the actual view (per `useWoMetrics.ts`) exposes `*_sec` columns (response_time_sec, active_repair_sec, line_downtime_sec, etc.) — there is no `elapsed_minutes` column. I'll use the existing `_sec` fields and convert.

Remaining manual duration calculations in AnalyticsPage:
- Line 153: `slaCompliance` → uses `differenceInMinutes(received_at, created_at)` → replace with `m.response_time_sec / 60`
- Line 188: `downtimeByMachine` → uses `differenceInMinutes(finished_at, started_at)` → replace with `m.active_repair_sec / 60` (or `line_downtime_sec` if that's what's intended)
- Lines 227, 229: `engineerPerformance` → uses `differenceInMinutes` for response and MTTR → replace with `response_time_sec` and `active_repair_sec`
- Line 214: `maintenanceFrequency` → `differenceInMinutes(lastWO, firstWO)` between WO creation dates — this is NOT a duration metric on the view; it's a span between events. Keep it.
- Lines 99-100: MTBF gaps between WO creation dates — same, not on the view. Keep.
- Line 111: range size in days — UI helper, not metric. Keep.

Let me check how `engineerPerformance` keys WOs (by `engineer_id`) so I can join woMetricsRange.

<lov-plan>

## Goal
Replace remaining manual `differenceInMinutes(timestamp_a, timestamp_b)` duration math in `AnalyticsPage.tsx` with values from `v_wo_metrics` (already fetched via `useAllWoMetrics`). Keep timestamp arithmetic that is NOT a per-WO duration (MTBF gaps between separate WOs, range-day calculation, maintenance frequency span).

Note: the view exposes `*_sec` columns (`response_time_sec`, `active_repair_sec`, `line_downtime_sec`, etc.) — there is no `elapsed_minutes` column. I'll convert seconds → minutes inline (`/ 60`).

## Changes (all in `src/pages/dashboard/AnalyticsPage.tsx`)

Build a single lookup once: `metricsById = new Map(woMetricsRange.map(m => [m.id, m]))`. Then:

1. **`slaCompliance` (line ~147)** — replace `differenceInMinutes(received_at, created_at)` with `metricsById.get(wo.id)?.response_time_sec / 60`. Skip WOs without a metric row.

2. **`downtimeByMachine` (line ~184)** — replace `differenceInMinutes(finished_at, started_at)` with `metricsById.get(wo.id)?.active_repair_sec / 60`. Rationale: this card is labeled "downtime by machine" but is actually computing active repair minutes; keep semantics identical. (If we ever want true line-down minutes, switch to `line_downtime_sec`.)

3. **`engineerPerformance` (line ~219)** — drop the two `differenceInMinutes` calls; pull `response_time_sec` and `active_repair_sec` from the view per WO. Iterate `woMetricsRange` joined to `allWOs` by id so we still get `engineer_id` / `engineer_name`.

4. **Keep as-is** (NOT per-WO durations):
   - MTBF gaps (lines 96-104) — gaps between separate WO creation timestamps.
   - `rangeDays` (line 110) — UI date span.
   - `maintenanceFrequency` months span (line 214) — span between first/last WO creation per machine.

5. **Imports** — keep `differenceInMinutes` (still used by MTBF + maintenance frequency).

## Verification

- [ ] Avg Response, Avg MTTR, SLA %, Downtime by Machine and Engineer ranking all match Manager Dashboard / WO Detail for the same period.
- [ ] WOs missing from `v_wo_metrics` (e.g., still open) do not break aggregations — they're skipped.
- [ ] Switching date range refetches both `useWorkOrders` and `useAllWoMetrics`; numbers stay consistent.
- [ ] No console errors.

## Files Changed
| File | Change |
|------|--------|
| `src/pages/dashboard/AnalyticsPage.tsx` | Replace manual `differenceInMinutes` per-WO duration math with `v_wo_metrics` lookups in 3 memos |

