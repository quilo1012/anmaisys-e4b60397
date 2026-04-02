

# Fix: Work Order Print/PDF Output

## Current Issues

1. **Engineer name**: Uses `wo.engineer?.name` (joined from `engineers` table) — but if the join fails or returns null, falls back to "—" instead of using the always-saved `wo.engineer_name` column
2. **Signature section**: Has "Requested By" and "Approved By" — should be "Engineer Signature" and "Operator Signature"
3. **No operator signature section** exists in print

## Changes — Single File: `src/pages/dashboard/WorkOrderDetail.tsx`

### 1. Use `engineer_name` column as primary, join as fallback
In the Personnel section (line 243) and anywhere engineer name appears, use:
```
wo.engineer_name || wo.engineer?.name || "—"
```
This ensures the real PIN-verified engineer name always shows.

### 2. Replace signature section (lines 371-389)
Replace "Requested By" + "Approved By" with:

**Engineer Signature** — pre-filled with `wo.engineer_name || wo.engineer?.name`
**Operator Signature** — pre-filled with `wo.operator?.name || wo.requester_name`

Both with date fields and signature lines.

### 3. No other files changed
The Engineer Dashboard already opens `WorkOrderDetail` via `window.open(/dashboard/wo/${wo.id})` for printing. Print CSS already hides sidebar/nav/buttons. No changes needed elsewhere.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/dashboard/WorkOrderDetail.tsx` | Use `engineer_name` column; replace signature section with Engineer + Operator signatures |

