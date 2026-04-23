

## Plan — Lock Operator Tablets to Their Paired Line

Most of the device-pairing infrastructure already exists. This plan closes the remaining gaps so each tablet is hard-locked to its assigned line, with no manual override and full server-side enforcement.

### What's already in place (no work needed)

- `devices` table with `device_token` ↔ `line_id` pairing
- `x-device-token` header injected into every Supabase request via `src/lib/deviceFetch.ts`
- `current_device_line()` SQL function and operator RLS policies on `work_orders` that already require `line_id = current_device_line()` for both SELECT and INSERT
- Admin/Manager **Devices** page (`/dashboard/devices`) for pairing
- `useDeviceLine()` hook and partial usage in OperatorDashboard

### What's missing / wrong

1. Operator dashboard still renders `<LinePicker>` and lets the operator change the line via state — even though the form is auto-set to the device line, the picker is visible and interactive.
2. No clear "this tablet is locked to Line X" banner.
3. When the tablet is **unpaired**, the operator can still see the form, see other lines' data via legacy `operatorOnly` fallback, and attempt to submit (RLS will reject, but UX is broken).
4. No setup/blocking screen showing the device token so an admin can pair it.
5. `useWorkOrders` falls back to `operatorOnly: true` when unpaired — should instead return empty + block.

### Changes

**1. New `OperatorLineGuard` component** (wraps operator dashboard content)

Reads `useDeviceLine()`. Three states:
- **Loading** → spinner
- **Unpaired** (`line_id = null`) → full-screen setup card:
  - Big lock icon + heading "This tablet is not assigned to a production line"
  - Sub-text explaining an admin/manager must pair it
  - Device token shown in a monospace box with copy button
  - Link/instruction: "Ask your supervisor to open Devices and pair this token"
  - **No** access to WO list or create form
- **Paired** → renders children, passes `lineId` + `lineName` via context

**2. New `DeviceLineContext`** (`src/contexts/DeviceLineContext.tsx`)

Lightweight provider exposing `{ lineId, lineName, deviceToken, label }` so all operator screens read the same source of truth without prop-drilling.

**3. Refactor `OperatorDashboard.tsx`**

- Wrap `OperatorDashboardContent` in `OperatorLineGuard`
- Remove `<LinePicker>` from the form entirely
- Remove `lineId` local state (use context)
- Add a **prominent locked-line banner** at the top of the dashboard:
  ```
  ┌──────────────────────────────────────────────┐
  │ 🔒 This tablet is locked to: LINE 3          │
  │    All work orders will be assigned to this  │
  │    line automatically.                       │
  └──────────────────────────────────────────────┘
  ```
- Keep mobile-asset (sealer/printer) sub-pickers when the locked line is the Sealer/Printer line — those are *per-WO* asset choices, not line choices. Extract that small portion out of `LinePicker` into a new `MobileAssetSubPicker` component used only when needed.
- `handleSubmit` always uses `context.lineId`; never reads form state for line.

**4. Tighten `useWorkOrders` behavior for operators**

In `OperatorDashboard`, stop falling back to `{ operatorOnly: true }`. If `deviceLineId` is missing, the guard already blocks rendering, so the hook is never called in the unpaired case. Pass only `{ lineId: deviceLineId }`.

**5. Block direct-URL access from other screens**

The only operator-accessible routes are `/dashboard/operator` and `/dashboard/wo/:id`. RLS already prevents reading WOs from other lines, so direct URL changes return empty — no extra code needed. Verified.

**6. No backend/migration changes**

All required RLS, RPCs (`pair_device`, `unpair_device`, `current_device_line`, `touch_device`), and policies already exist and are correct. The plan is purely frontend.

### Files

**New**
- `src/contexts/DeviceLineContext.tsx` — provider + `useDeviceLineCtx()` hook
- `src/components/OperatorLineGuard.tsx` — wrapper with paired/unpaired states
- `src/components/MobileAssetSubPicker.tsx` — extracted sealer+printer pickers (~80 lines copied from LinePicker)

**Modified**
- `src/pages/dashboard/OperatorDashboard.tsx` — wrap in guard, remove LinePicker, add locked-line banner, drop legacy fallback, use context
- (Optional cleanup) `src/components/LinePicker.tsx` — leave as-is; still used by Manager/Admin WO creation flows

### Technical details

- **Banner styling**: `border-2 border-primary bg-primary/10`, `Lock` icon from lucide-react, `text-2xl font-bold` for line name. Sticky-top isn't needed since Operator dashboard is already short.
- **Unpaired screen**: full-height centered card with `Tablet` icon, token in `<Input readOnly>` + copy button (reuse pattern from `DevicesPage`).
- **Token display**: use `getDeviceToken()` already exported from `useDevice.ts`.
- **RLS confirmation**: existing INSERT policy `Operators create WOs on device line` already enforces `line_id = current_device_line()` server-side, so even a tampered client cannot inject a different line.
- **Mobile assets**: the sealer/printer sub-picker stays because it picks *which* mobile asset on the locked line, not which line.
- **No changes to `useDeviceLine` query** — already invalidates correctly when admin pairs/unpairs.

### Out of scope

- Re-binding tokens across browsers (each browser/localStorage = one device — this is intentional and matches the original design).
- Auto-detecting tablet-vs-laptop — pairing remains explicit.
- Non-operator roles — engineers/admins/managers continue to work without device locking.

