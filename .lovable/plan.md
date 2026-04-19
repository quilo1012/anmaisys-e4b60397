

User wants loading skeletons on the Analytics page while data is being fetched, instead of empty cards/charts or a blank screen.

Let me check the current loading state of `AnalyticsPage.tsx`.

From the summary: it uses `useWorkOrders`, `useProducts`, `useMachines`, `useEngineerScores`, `useAllWoMetrics`, plus a direct `useQuery` for parts. None of these loading states appear to be surfaced — the page renders KPI cards and charts immediately, showing `0` / empty arrays until data arrives.

`Skeleton` component already exists at `src/components/ui/skeleton.tsx`.

## Plan

Add skeleton placeholders to `src/pages/dashboard/AnalyticsPage.tsx` that render while any of the primary data sources are still loading.

### Approach

1. Pull `isLoading` flags from the main hooks: `useWorkOrders`, `useMachines`, `useAllWoMetrics`, `useEngineerScores`, and the inline parts query.
2. Compute `const isLoading = woLoading || machinesLoading || metricsLoading || scoresLoading || partsLoading;`
3. When `isLoading` is true (and there's no cached data yet), render a skeleton layout that mirrors the real page structure:
   - Header row (title + date range filters): keep real header so filters remain interactive.
   - 4–6 KPI cards: `<Skeleton className="h-28 w-full" />` in the same grid.
   - 2 chart rows (2 columns each): `<Skeleton className="h-72 w-full" />` per chart slot.
   - Engineer ranking table: `<Skeleton className="h-64 w-full" />`.
4. Once data arrives, render the existing content as-is.

### Why this shape

- Matches the existing grid (`grid gap-4 md:grid-cols-4` for KPIs, `md:grid-cols-2` for charts) so layout doesn't shift when real content loads.
- Keeps the date range filter usable during load (changing it just retriggers the same skeleton state).
- Uses the existing `Skeleton` primitive — no new dependencies.

### Files Changed
| File | Change |
|------|--------|
| `src/pages/dashboard/AnalyticsPage.tsx` | Surface `isLoading` from data hooks; render skeleton grid (KPIs + charts + table) while loading |

### Verification
- Hard-refresh `/dashboard/analytics` → skeletons appear immediately, then real content swaps in.
- Layout doesn't jump when data arrives (skeleton heights match real card heights).
- Changing date range while loading keeps skeletons visible until refetch resolves.
- No console errors.

