

# Fix 4 Targeted Issues

## 1. Print Page — Remove browser header/footer

**File: `src/index.css`** (lines 114-116)

Change `@page` margin from `20mm` to `10mm` and add `margin-top: 0; margin-bottom: 0` to suppress browser header/footer area. Browsers use the margin area for URL/date — reducing it minimizes or eliminates them.

```css
@page {
  margin: 10mm 10mm 10mm 10mm;
  size: A4;
}
```

Also add to the `@media print` block:
```css
.app-footer, .print-url {
  display: none !important;
}
```

No component changes needed — the URL is a browser-level feature controlled by `@page` margins.

## 2. Analytics — Date Range Filters

**File: `src/pages/dashboard/AnalyticsPage.tsx`**

- Add state for `startDate` and `endDate` (default: last 30 days)
- Add a filter bar below the header with two date pickers (using Popover + Calendar) and a period preset dropdown (7d / 30d / 90d / Custom)
- Filter `allWOs` by `created_at` within the selected range before passing to all `useMemo` calculations
- All existing KPI, chart, and ranking computations already derive from `allWOs` — filtering at the source propagates everywhere

## 3. Clear Audit / Clear WOs — Fix response handling

The edge functions and DB functions work correctly. The issue is that `verify-admin-pin` returns `status: 401` when PIN is invalid, and `supabase.functions.invoke` treats non-2xx as an error.

**File: `src/pages/dashboard/AuditLogsPage.tsx`** (line 43-49)
- The `supabase.functions.invoke` call sets `verifyError` when status is 401
- Current code: `if (verifyError || !verifyData?.valid)` — this works but `verifyData` may be null when there's an error
- Fix: parse the response body from the error to check if it contains `valid: false` vs actual error
- Better approach: change to use raw `fetch` like WorkOrdersPage does, so we can read the JSON body regardless of status code

**File: `src/pages/dashboard/WorkOrdersPage.tsx`** (line 576-580)
- Same issue — `supabase.functions.invoke` with 401 status sets `pinError` and `pinResult` may be null
- Fix: also switch to raw `fetch` for consistency

Both clear operations will also call `queryClient.invalidateQueries` after success to force data refresh.

## 4. Checklist Items — Empty defaults (no auto-fill)

**File: `src/pages/dashboard/ProblemsPage.tsx`** (line 43)
- Change `const [newType, setNewType] = useState("Safety")` → `useState("")`
- The `+ Add` button is disabled when `!newType` (line 121) — this is correct behavior; user must explicitly select a type
- The placeholder "Select type..." already shows when value is empty

No other changes needed — the user requested empty fields, and requiring type selection before adding is the intended UX.

## Files to modify

| File | Change |
|------|--------|
| `src/index.css` | Reduce `@page` margin, hide `.app-footer`/`.print-url` |
| `src/pages/dashboard/AnalyticsPage.tsx` | Add date range filter bar with presets |
| `src/pages/dashboard/AuditLogsPage.tsx` | Fix PIN verify to use raw `fetch` |
| `src/pages/dashboard/WorkOrdersPage.tsx` | Fix PIN verify response handling (already uses fetch — verify flow) |
| `src/pages/dashboard/ProblemsPage.tsx` | Reset `newType` default to `""` |

No database migrations needed.

