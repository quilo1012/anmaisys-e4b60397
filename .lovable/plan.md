

# Bug Fixes: Engineer WO Flow + Checklist Editor

## Bug 1: Accept + Start WO not updating status

**Root cause**: The mutation `acceptAndStartWO.mutate()` is called without error handling. If the Supabase update fails (RLS silent rejection, trigger error, or any exception), the error is swallowed — no toast, no feedback, and the UI just re-renders showing the same "Open" state. Additionally, `logWOAction` never checks for errors, so a failure there could silently break the flow.

**Fix in `EngineerDashboard.tsx`**:
- Switch from `acceptAndStartWO.mutate()` to `acceptAndStartWO.mutateAsync()` inside a try/catch
- Show a success toast on completion, error toast on failure
- Same treatment for `startWO`

**Fix in `useWorkOrders.ts`**:
- After the `.update()`, add `.select()` to verify rows were actually affected — if no data returned, throw an explicit error
- Add error checking to `logWOAction` so failures are caught and reported
- The `useAcceptAndStartWorkOrder` mutation already sets all correct fields (`status`, `engineer_id`, `engineer_name`, timestamps) — the logic is correct, it just needs robust error handling

## Bug 2: Checklist editor auto-fills default values

**Root cause**: In `ProblemsPage.tsx`, the `ChecklistManager` component initializes `newType` state to `"Safety"` (line 43). This means every new row starts with "Safety" pre-selected.

**Fix in `ProblemsPage.tsx`**:
- Change `useState("Safety")` to `useState("")`
- Add a placeholder option to the Select ("Select type...")
- Disable the Add button when `newType` is empty (in addition to the existing `newDesc` check)

## Files Modified

| File | Change |
|------|--------|
| `src/pages/dashboard/EngineerDashboard.tsx` | Use `mutateAsync` with try/catch + toast for Accept+Start and Start actions |
| `src/hooks/useWorkOrders.ts` | Add `.select()` verification after update; add error handling in `logWOAction` |
| `src/pages/dashboard/ProblemsPage.tsx` | Remove default "Safety" type; add placeholder; require type selection |

