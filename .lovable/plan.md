

# Fix: WO Print Output + Hide Internal Chat

## Changes

### 1. Remove Internal Chat from WO Detail (`src/pages/dashboard/WorkOrderDetail.tsx`)
- Remove the `WOChat` import and the chat section (lines 394-397)
- Remove the `useWOMessages`/`useSendWOMessage` related import

### 2. Ensure real engineer name in Parts Used table
- The current join `profiles!parts_used_engineer_id_fkey(name)` should return real names since `parts_used.engineer_id` stores auth user ID → profiles
- If the join fails (no profile match), fall back to the WO's `engineer_name` field: change `{pu.engineer?.name || "—"}` to `{pu.engineer?.name || wo.engineer_name || ""}`
- If all missing, leave blank (empty string, not "—")

### 3. Use real engineer name consistently
- Already using `wo.engineer_name || wo.engineer?.name` in Personnel and Signatures — no change needed there
- Leave blank instead of "—" when data is missing (per requirement)

### 4. No other areas changed
- Print CSS already hides sidebar, nav, buttons
- Signature sections already correct (Engineer + Operator)
- Both Engineer and Manager views use same `WorkOrderDetail` component

## Files Modified

| File | Change |
|------|--------|
| `src/pages/dashboard/WorkOrderDetail.tsx` | Remove WOChat; fix parts engineer name fallback; use blank for missing data |

