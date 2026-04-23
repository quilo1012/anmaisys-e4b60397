

## Plan — Multiple Allowed Lines per Tablet

Refactor the device-line model from **1 tablet → 1 line** to **1 tablet → many allowed lines**, with operator selection scoped to that allowed set and full RLS enforcement.

### Database changes

**New table `device_lines`** (junction):
```
id uuid pk, device_id uuid ref devices(id) on delete cascade,
line_id uuid ref lines(id) on delete cascade,
created_at timestamptz default now(),
unique (device_id, line_id)
```
RLS:
- SELECT: any authenticated (needed by operator to load own allowed list)
- INSERT/DELETE: admin or manager only

**Backfill**: copy existing `devices.line_id` into `device_lines` so paired tablets keep working.

**Keep `devices.line_id` column** for now as a deprecated cache of the *primary* line (no schema break; can drop later). New writes go through the junction.

**Replace SQL functions**:
- `current_device_line_ids() returns uuid[]` — array of all allowed line IDs for the calling device token. SECURITY DEFINER.
- `pair_device_lines(_token text, _line_ids uuid[], _label text)` — admin/manager only; replaces the device's allowed-line set atomically (delete + bulk insert). Also auto-registers the device row if missing. Updates `devices.label` and `paired_at/paired_by`.
- `unpair_device(_device_id uuid)` — keep, but also clear `device_lines` for that device.
- Keep `current_device_line()` as a backward-compat helper returning the *first* allowed line (used only by legacy code; no new RLS depends on it).

**Update RLS on `work_orders`**:
- `Operators view own line WOs (device-scoped)`: change `line_id = current_device_line()` → `line_id = ANY(current_device_line_ids())`.
- `Operators create WOs on device line`: same change for the `WITH CHECK`.

This guarantees the server only allows reads/inserts for lines in the device's allowed set, regardless of what the client sends.

### Frontend changes

**`useDevice.ts`**
- `useDeviceLines()` returns `{ token, allowedLineIds: string[], label: string|null }` (renamed from `useDeviceLine`).
- `usePairDeviceLines()` takes `{ token, lineIds: string[], label? }` and calls `pair_device_lines`.
- Keep `getDeviceToken()` as-is.

**`DeviceLineContext.tsx`** (refactor)
- Provider value becomes:
  ```
  { allowedLineIds: string[], allowedLines: Line[],
    selectedLineId: string, selectedLineName: string,
    setSelectedLineId: (id: string) => void,
    deviceToken: string, label: string|null }
  ```
- `selectedLineId` persists to `localStorage` (`an_selected_line_id`) so a refresh keeps the choice.
- If exactly one allowed line → auto-select & lock it.
- If multiple → default to last-used (from localStorage) or first.

**`OperatorLineGuard.tsx`** (refactor)
- Loading → spinner (unchanged).
- `allowedLineIds.length === 0` → existing "Tablet not assigned" setup card with token (unchanged copy).
- `allowedLineIds.length >= 1` → render context provider + a top banner:
  - **One line**: same locked banner as today ("This tablet is locked to **Line X**").
  - **Multiple lines**: banner shows token label + a `<Select>` listing only the allowed lines. Header text: "Tablet authorized for: **Line 1, Blender 1**". The Select controls `selectedLineId` in context.

**`OperatorDashboard.tsx`**
- Replace `useDeviceLineCtx().lineId` with `selectedLineId`; `lineName` with `selectedLineName`.
- WO list: still `useWorkOrders({ lineId: selectedLineId })` — automatically updates when operator switches.
- Submit: `line_id: selectedLineId` (RLS enforces it must be in the allowed set, so client tampering is blocked).
- `MobileAssetSubPicker` keeps working — sealer/printer detection runs against `selectedLineName`.

**`DevicesPage.tsx`** (admin/manager)
- Replace single-line `<Select>` with a **multi-line picker** (checkbox list of all lines or a `react-select`-style multi combobox). Reuse simple checkbox pattern to avoid new deps.
- "Pair a Tablet" form: token + label + checkboxes of lines + "Save" button → calls `pair_device_lines` with the chosen array.
- Devices table column "Line" → "Allowed Lines" showing badges, e.g. `[Line 1] [Blender 1]`. Edit button opens an inline dialog with the same checkbox picker preloaded with current selection.
- "Unpair" button still calls `unpair_device` (clears the junction).

**`useAllDevices()`**
- Update query to also fetch `device_lines` joined with `lines.name`, returning `{ ...device, lines: [{id, name}] }`.

### Files

**Modified**
- `src/hooks/useDevice.ts` — new hooks + types
- `src/contexts/DeviceLineContext.tsx` — array + selection + persistence
- `src/components/OperatorLineGuard.tsx` — multi-line banner + selector
- `src/pages/dashboard/OperatorDashboard.tsx` — read `selectedLineId` from context
- `src/pages/dashboard/DevicesPage.tsx` — multi-line picker + display
- `src/hooks/useWorkOrders.ts` — no change (already accepts `lineId`)

**New**
- Migration: `device_lines` table, `current_device_line_ids()`, `pair_device_lines()`, updated `unpair_device`, updated `work_orders` RLS, backfill, RLS on `device_lines`.

### Banner UX (multi-line example)

```
┌─────────────────────────────────────────────────────────┐
│ 🔒 Tablet locked to: [ Line 1 ▼ ]                        │
│    Authorized lines: Line 1 · Blender 1                  │
│    All work orders use the line selected above.          │
└─────────────────────────────────────────────────────────┘
```

### Security recap

- RLS uses `current_device_line_ids() @> ARRAY[line_id]` (or `line_id = ANY(...)`) on **both** SELECT and INSERT for operators.
- Operator UI only ever shows allowed lines (frontend filtering).
- Even if the client tampers with `line_id`, INSERT is rejected by RLS unless that line is in the device's junction set.
- `device_lines` write access (INSERT/DELETE) restricted to admin/manager.

### Out of scope

- Removing the now-deprecated `devices.line_id` column (kept for backward compat; can drop in a follow-up).
- Cross-tablet syncing of operator's last-selected line (it's per-device localStorage by design).
- Engineer/admin/manager flows — no device-line restriction applies to them.

