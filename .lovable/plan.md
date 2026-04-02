

# Fix: Accept + Start WO Not Persisting

## Analysis

The DB schema is correct (FK now points to `engineers`). The mutation code sets all required fields. The likely issue is a **race condition in the PinDialog callback chain**: 

1. PinDialog's `handleConfirm` calls `onSuccess(engineer)` then `onOpenChange(false)` synchronously
2. `onSuccess` fires the async mutation but doesn't await it
3. `onOpenChange(false)` triggers `setPendingPinAction(null)` and `setPinDialogOpen(false)`, causing immediate re-renders
4. The re-render cascade may interrupt or lose the mutation context

Additionally, `logWOAction` uses `as any` casts unnecessarily since `work_order_logs` exists in the types.

## Fix

**File: `src/pages/dashboard/EngineerDashboard.tsx`**

Make the `onSuccess` handler async-safe by capturing the action before clearing state, and ensure the mutation completes before cleanup:

```typescript
onSuccess={async (engineer) => {
  const action = pendingPinAction;
  setPinDialogOpen(false);
  setPendingPinAction(null);
  if (action) await action(engineer);
}}
```

Remove the `onOpenChange` cleanup that duplicates state clearing — let `onSuccess` handle everything:

```typescript
onOpenChange={(open) => {
  if (!open && !pendingPinAction) {
    // Only clean up if user cancelled (not after success)
    setPinDialogOpen(false);
    setPendingPinAction(null);
  } else {
    setPinDialogOpen(open);
  }
}}
```

**File: `src/hooks/useWorkOrders.ts`**

Remove unnecessary `as any` casts from `logWOAction` since `work_order_logs` is in the generated types. This is cleanup only — doesn't affect the bug.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/dashboard/EngineerDashboard.tsx` | Fix async race condition in PinDialog callbacks |

