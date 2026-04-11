

# Fix Operator Dashboard Form Layout

## Problem identified in screenshot

The **Observations (optional)** textarea (line 166) sits in the left column only, creating an empty gap on the right side of the 2-column grid. This looks broken and wastes space.

## Fix

**File: `src/pages/dashboard/OperatorDashboard.tsx`** (line 166)

Add `md:col-span-2` to the Observations wrapper so it spans the full width, matching the retroactive toggle and submit button below it:

```tsx
// Line 166: change from
<div className="space-y-2">
// to
<div className="space-y-2 md:col-span-2">
```

This is the only change needed — one CSS class addition to one `<div>`.

