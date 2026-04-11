

# Fix Work Order Print/PDF Layout

## Changes

### 1. Fix Total Time calculation (`WorkOrderDetail.tsx` line 183)
Current code only calculates `totalTime` when WO is closed/completed. For in-progress WOs, it returns `null` → shows "—".

**Fix:** Calculate total time as sum of components, and for in-progress WOs, calculate up to now:
```typescript
const totalTime = (wo.closed_at || wo.completed_at)
  ? differenceInMinutes(new Date(wo.closed_at || wo.completed_at!), new Date(wo.created_at))
  : (responseTime || 0) + (travelTime || 0) + (repairTime !== null ? repairTime : (wo.started_at ? differenceInMinutes(new Date(), new Date(wo.started_at)) : 0));
```

### 2. Improve print logo (line 199-201)
Change logo from `h-10 w-10` to `h-12` (height ~50px), and make "AN MAINTENANCE" text larger/bolder.

### 3. Add stronger print CSS (`src/index.css`)
Add these rules to the existing `@media print` block to ensure DashboardLayout chrome is fully hidden:
- Hide all `button` elements
- Hide `.breadcrumb`, `[data-sidebar]` elements (already partially there but needs reinforcement)
- Target the specific DashboardLayout header bar containing the sidebar trigger and breadcrumb

### 4. Priority in print header — already plain text (line 216)
The print metadata row at line 216 already shows `{pri.label}` as plain text, not a badge. No change needed here — the issue is that the screen-only badges (line 240) might bleed through. They already have `print:hidden` on line 234. Will verify CSS specificity.

## Files to modify

| File | Change |
|------|--------|
| `src/pages/dashboard/WorkOrderDetail.tsx` | Fix totalTime calc for in-progress WOs; enlarge logo; ensure all screen elements have `print:hidden` |
| `src/index.css` | Add print rules to hide breadcrumb bar and all buttons more aggressively |

## Technical details
- No database changes needed
- The `print:hidden` class on line 224 already hides Back/Print buttons, but the DashboardLayout's own header (with sidebar trigger + breadcrumb) wraps outside this component — needs CSS-level hiding
- The `formatDuration` function (line 53-59) already handles the display format correctly, just needs a non-null value

