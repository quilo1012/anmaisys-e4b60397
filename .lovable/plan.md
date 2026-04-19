

User wants empty-state messaging on Analytics charts when there are zero work orders to display, instead of blank/empty Recharts canvases.

Let me check the current Analytics page chart structure.
<lov-tool-use id="toolu_vrtx_017rUcgGYPE88k5g45AzMJzM" name="code--search_files" integration-id="code" data="{\"query\": \"<BarChart|<LineChart|<PieChart|<AreaChart|ResponsiveContainer\", \"include_patterns\": \"src/pages/dashboard/AnalyticsPage.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_011vFegv853vU9S2uuy6NDh1" name="code--search_files" integration-id="code" data="{\"query\": \"ResponsiveContainer|BarChart|LineChart|PieChart\", \"include_patterns\": \"src/pages/dashboard/AnalyticsPage.tsx\"}">
</lov-tool-use>
I have enough context. The page has ~6+ chart cards. Two already have empty-state guards (Problem Types, Machine Status). The others (WOs per Day, Orders by Status, Lines with Most Problems, Top 5 Problems, plus possibly more below line 461) render charts unconditionally — showing empty axes when there's no data.

<lov-plan>

## Plan

Add a "No data available" empty-state message to every chart card in `src/pages/dashboard/AnalyticsPage.tsx` whose underlying dataset can be empty. Two cards (Problem Types, Machine Status) already do this — I'll mirror that exact pattern across the rest.

### Approach

For each chart card, wrap the `<ResponsiveContainer>` in a conditional:

```tsx
{data.length === 0 ? (
  <p className="text-muted-foreground text-sm text-center py-8">No data available</p>
) : (
  <ResponsiveContainer ...>...</ResponsiveContainer>
)}
```

### Charts to update

Based on the file scan, these chart cards currently render unconditionally and need the guard:

1. **WOs per Day (Last 7 Days)** — guard on `wosPerDay.length`
2. **Orders by Status** — guard on `ordersByStatus.length`
3. **Lines with Most Problems** — guard on `lineProblems.length`
4. **Top 5 Problems** — guard on its data array
5. Any remaining chart cards below line 461 (engineer ranking chart, parts-used chart, etc.) — apply the same pattern

Already correct (no change needed):
- **Problem Types** (line 412) — already shows "No data yet."
- **Machine Status** (line 435) — already shows "No machines yet."

### Copy

Use the exact string **"No data available"** (matches user request) for the new guards. Leave the two existing messages ("No data yet.", "No machines yet.") as-is to avoid churn — or normalize them to "No data available" too. I'll **normalize all three** for consistency.

### Files Changed
| File | Change |
|------|--------|
| `src/pages/dashboard/AnalyticsPage.tsx` | Wrap each `<ResponsiveContainer>` in an empty-data guard rendering "No data available"; normalize existing empty-state copy |

### Verification
- On a fresh account / filtered date range with zero WOs, every chart card shows "No data available" instead of empty axes.
- When data exists, charts render normally.
- Loading skeleton (added previously) still appears first; empty state appears after load resolves with no data.
- No console errors.

