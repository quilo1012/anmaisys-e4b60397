

# Fix: Make "Requested By" a Manual Editable Input

## Problem
The "Requested By" field auto-populates from `profile?.name` and is read-only. User wants it to start empty and be manually editable.

## Changes — `src/pages/dashboard/OperatorDashboard.tsx`

### 1. Add state variable (after line 42)
```tsx
const [requestedBy, setRequestedBy] = useState("");
```

### 2. Replace the read-only div (lines 131-136) with an editable Input
```tsx
<div className="space-y-2">
  <Label>Requested By</Label>
  <Input
    value={requestedBy}
    onChange={(e) => setRequestedBy(e.target.value)}
    placeholder="Enter requester name"
    autoComplete="off"
  />
</div>
```

### 3. Fix validation (line 87)
Change `!profile?.name` to `!requestedBy.trim()`.

### 4. Fix mutation payload (line 105)
Change `requester_name: (profile?.name || "").trim()` to `requester_name: requestedBy.trim()`.

### 5. Fix form reset (line 107)
Add `setRequestedBy("");` to the reset line.

No database or backend changes needed — the `requester_name` column has no default value to worry about.

