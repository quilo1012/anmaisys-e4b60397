

# Professional Polish: Operator UX, Alert Sound, Print, WO Table Layout, LINE Filter

## Summary

Remove priority from operator form, upgrade alert sound to professional two-tone chime, add operator notification on WO completion, improve WO table layout (LINE column first), add LINE filter, enhance print to only show WO content, and add Print Report button.

---

## Changes

### 1. Remove Priority from Operator Form
**File:** `src/pages/dashboard/OperatorDashboard.tsx`
- Remove priority state, Select field (lines 43, 111-122), and priority column from the table
- Hardcode `priority: "medium"` in the create call
- Remove `priorityConfig` import/usage from operator table

### 2. Professional Two-Tone Alert Sound
**File:** `src/lib/shifts.ts`
- Replace `generateBeepWav()` with a professional two-tone industrial chime: 880Hz descending to 660Hz, 0.6s duration, smooth fade envelope
- Higher sample rate (16000) for cleaner sound
- Change loop interval from 1s to 2.5s for less aggressive but persistent alerting
- Add new `playNotificationChime()` export -- single pleasant sound for operator feedback (not looping)

### 3. Operator Receives Notification When WO is Finished/Closed
**File:** `src/hooks/useWOAlerts.ts`
- Add a new effect for operators: subscribe to UPDATE events on `work_orders`
- When a WO owned by the operator (`operator_id === user.id`) changes to `finished` or `closed`, play a single notification chime + toast + web notification
- Operators do NOT get the continuous alarm loop -- only engineers and admins do

### 4. WO Table: LINE Column + Sort by Line Priority
**File:** `src/pages/dashboard/WorkOrdersPage.tsx`
- Cross-reference each WO's `machine` with `machines` data to get the `line` field
- Add LINE as the first column in the table: LINE | MACHINE | PROBLEM | STATUS | DATE
- Sort filtered WOs by line name first (alphabetical), then by `created_at` descending
- Add a LINE filter dropdown (from distinct machine lines)
- Remove Priority column from the default table view (priority is auto-set, not user-facing)

### 5. Print Only WO Content
**File:** `src/index.css`
- Enhance `@media print` rules: hide all filters, pagination, action buttons, sidebar, header
- Show only `.print-content` elements
- Add `@page { margin: 15mm; }` for proper print margins

**File:** `src/pages/dashboard/WorkOrdersPage.tsx`
- Add "Print Report" button next to CSV export
- Wrap the WO table in a `print-content` div
- Add a print-only header showing date range and filter summary
- `window.print()` on click

### 6. Operator WO Form: Only Machine + Problem
**File:** `src/pages/dashboard/OperatorDashboard.tsx`
- Keep only: Requested By, Machine (select), Problem (select), Notes (optional)
- Remove priority entirely from the operator experience

---

## Files Modified

| File | Change |
|------|--------|
| `src/pages/dashboard/OperatorDashboard.tsx` | Remove priority, simplify form |
| `src/lib/shifts.ts` | Professional two-tone alert + notification chime |
| `src/hooks/useWOAlerts.ts` | Add operator finish notification |
| `src/index.css` | Enhanced print styles |
| `src/pages/dashboard/WorkOrdersPage.tsx` | LINE column, LINE filter, sort by line, Print Report button, print header |

## Implementation Sequence
1. Alert sound upgrade (`shifts.ts`)
2. Operator dashboard cleanup (remove priority)
3. Operator finish notification (`useWOAlerts.ts`)
4. WO table: LINE column + filter + sort + print (`WorkOrdersPage.tsx`)
5. Print styles (`index.css`)

