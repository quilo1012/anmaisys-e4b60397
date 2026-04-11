

# Fix Operator Dashboard: Replace "Requested By" Input with Static Display

## Problem
The "Requested By" field is an `<Input>` element, causing browser auto-fill interference and making it appear editable.

## Changes

### File: `src/pages/dashboard/OperatorDashboard.tsx`

1. **Remove `requesterName` state** (line 38) — no longer needed since the value comes directly from `profile?.name`.

2. **Replace Input with styled div** (lines 131-134):
```tsx
<div className="space-y-2">
  <Label>Requested By</Label>
  <div className="flex items-center h-10 px-3 rounded-md border border-input bg-muted text-sm">
    {profile?.name ?? '—'}
  </div>
</div>
```

3. **Fix submit payload** (line 105) — use `profile?.name` directly instead of `requesterName`:
```tsx
await createWO.mutateAsync({
  requester_name: (profile?.name || "").trim(),
  machine: machine.trim(),
  description: description.trim(),
  notes: notes.trim(),
  priority: "medium",
  created_at
});
```

4. **Remove `setRequesterName("")`** from the reset line (107).

