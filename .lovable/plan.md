

# Fix: PinDialog Async-Safe Success Flow

## Problem

In `PinDialog.tsx` line 56-62, `handleConfirm` is synchronous:
1. Calls `resetState()` (clears internal state)
2. Calls `onSuccess(engineer)` — parent's async handler starts but is NOT awaited
3. Immediately calls `onOpenChange(false)` — triggers parent cleanup

The parent's `onSuccess` (EngineerDashboard line 612-617) clears `pendingPinAction` before awaiting the mutation, but PinDialog also fires `onOpenChange(false)` in parallel, causing redundant state changes during the async mutation.

## Fix

**File: `src/components/PinDialog.tsx`**

1. Change `onSuccess` prop type to allow async: `(engineer: EngineerIdentity) => void | Promise<void>`
2. Make `handleConfirm` async — await `onSuccess(engineer)` before calling `onOpenChange(false)`
3. Show loading state during the async action so the user sees feedback

```typescript
const handleConfirm = async () => {
  if (!confirming) return;
  const engineer = confirming;
  setLoading(true);
  try {
    await onSuccess(engineer);
  } finally {
    setLoading(false);
    resetState();
    onOpenChange(false);
  }
};
```

**File: `src/pages/dashboard/EngineerDashboard.tsx`**

Simplify the `onSuccess` handler — no longer needs to capture/clear state since PinDialog now handles sequencing:

```typescript
onSuccess={async (engineer) => {
  if (pendingPinAction) await pendingPinAction(engineer);
  setPendingPinAction(null);
}}
onOpenChange={(open) => {
  setPinDialogOpen(open);
  if (!open) setPendingPinAction(null);
}}
```

## Files Modified

| File | Change |
|------|--------|
| `src/components/PinDialog.tsx` | Make `handleConfirm` async, await `onSuccess`, show loading |
| `src/pages/dashboard/EngineerDashboard.tsx` | Simplify callbacks, remove premature state clearing |

