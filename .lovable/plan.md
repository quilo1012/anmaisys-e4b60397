

# Phase 1: Operational Reliability — Fixes

## Issues Found

1. **Sign dialog cancel clears `currentEngineer`** — Lines 600 and 617 in `EngineerDashboard.tsx` clear the engineer identity when the Finish dialog is cancelled. This breaks state for any subsequent checklist or photo action on that WO.

2. **`formatDuration(0)` shows blank** — When travel time is 0 (Accept+Start shortcut), it displays nothing instead of "0 min".

3. **No checklist section in WO detail/print** — `WorkOrderDetail.tsx` has no checklist display at all. Completed checklist items should appear in the detail view and print document.

4. **Photos hidden in print** — Line 341 in `WorkOrderDetail.tsx` has `print:hidden` on the Photos card. Before/after photos should be visible in the printed document.

5. **Parts Used table missing print borders** — The table in the Parts Used card doesn't apply print-specific styling classes for the bordered professional look.

6. **Print CSS hides all buttons including nothing else needed** — Already handled correctly.

## Changes

### `src/pages/dashboard/EngineerDashboard.tsx`

**A. Don't clear `currentEngineer` on sign dialog cancel**
- Line 600: Remove `setCurrentEngineer(null)` from the `onOpenChange` handler
- Line 617: Remove `setCurrentEngineer(null)` from the Cancel button
- Keep the clear only in `handleFinishConfirm` (line 312-313) on successful finish

### `src/pages/dashboard/WorkOrderDetail.tsx`

**B. Fix `formatDuration(0)` to show "0 min"**
- Change `if (minutes === null) return ""` to also handle the display of 0 correctly (currently works: `0 < 60` returns `"0 min"` — actually this is correct, `0 min` would show). Let me re-verify... `if (minutes < 60) return \`${minutes} min\`` — yes, 0 would show "0 min". This is fine.

**C. Add checklist responses section**
- After the Timeline card and before Parts Used, add a new card that fetches and displays checklist responses for the WO
- Use `useChecklistResponses(id)` and `useChecklistsByProblemName(wo.description)`
- Show each item with completed/incomplete status, grouped by type
- In print: render as a bordered table with checkmark indicators

**D. Show photos in print**
- Remove `print:hidden` from the Photos card (line 341)
- Add print-specific styling: smaller images, grid layout with borders
- Photos will render via signed URLs which work in the print context

**E. Add print styling to Parts Used table**
- Add `print:border print:border-black` classes to the Parts card and table elements

### `src/index.css`

No changes needed — existing print CSS covers the new elements.

## Files Modified

| File | Changes |
|------|---------|
| `src/pages/dashboard/EngineerDashboard.tsx` | Stop clearing `currentEngineer` on sign dialog cancel |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Add checklist section; show photos in print; add print styling to parts table |

## What is preserved
- PIN requirements for Accept+Start and Finish (unchanged)
- Manager and engineer permissions/RLS (unchanged)
- Session/route stability (unchanged)
- All existing timing calculations (unchanged)

