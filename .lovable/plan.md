

The user wants to apply "these fixes" — referring to the next-step suggestions I offered after the empty-state work. The most relevant remaining items are:

1. Add an empty-state hint to KPI cards when values are zero.
2. Add a small icon next to "No data available" for a more polished empty state.

I'll do both since they're small, related polish items on the same page.

## Plan

Polish the Analytics page empty states.

### Changes to `src/pages/dashboard/AnalyticsPage.tsx`

**1. Iconified chart empty state**
Replace the plain `<p>No data available</p>` with a centered block:
```tsx
<div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
  <BarChart3 className="h-8 w-8 mb-2 opacity-50" />
  <p className="text-sm">No data available</p>
</div>
```
Apply to every chart card already guarded in the previous step.

**2. KPI card empty hint**
When the entire dataset is empty (no work orders in the selected period), show a subtle muted line under the zero value on each KPI card: `"No activity in selected period"`.
- Detect with `const hasNoActivity = !woLoading && rawWOs && rawWOs.length === 0;`
- Render the hint conditionally inside each KPI `<Card>` body.

### Files Changed
| File | Change |
|------|--------|
| `src/pages/dashboard/AnalyticsPage.tsx` | Add `BarChart3` icon to chart empty states; show "No activity in selected period" hint on KPI cards when zero WOs |

### Verification
- With zero WOs: each chart shows icon + "No data available"; each KPI card shows `0` plus the muted hint.
- With data: charts and KPIs render normally, no hint visible.
- No layout shift, no console errors.

