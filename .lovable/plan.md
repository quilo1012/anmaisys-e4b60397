

# Shared Login + Individual PIN Identity System

## Current vs Desired Architecture

**Current**: Each engineer has their own auth account. PIN verifies the logged-in user. `engineer_id` = `auth.uid()`.

**Desired**: One shared login account. PIN identifies the real engineer from a standalone `engineers` table. Actions belong to the PIN owner, not the session user.

## Database Changes

### 1. New `engineers` table
- `id` (uuid, PK)
- `name` (text, NOT NULL)
- `pin_hash` (text, NOT NULL) — bcrypt hash
- `is_active` (boolean, default true)
- `created_at` (timestamptz)

RLS: authenticated can SELECT active engineers; admin can ALL.

### 2. New `work_order_logs` table
- `id`, `work_order_id`, `engineer_id`, `engineer_name`, `action`, `created_at`

RLS: authenticated can SELECT and INSERT.

### 3. New DB functions
- `verify_pin_by_code(_pin text)` → returns `TABLE(engineer_id uuid, engineer_name text)` — searches all active engineers, compares bcrypt hash, returns match
- `set_engineer_pin_standalone(_engineer_id uuid, _new_pin text)` → hashes and stores PIN

### 4. Work orders
- `engineer_id` already exists (uuid) — will now reference `engineers.id` instead of `auth.users.id`
- Add `engineer_name` column (text, nullable) for denormalized display

## Edge Function Changes

### `verify-engineer-pin` — Rewrite
**Input**: `{ pin: "1234" }` (no user_id needed)
**Process**: Call `verify_pin_by_code(pin)` which scans all active engineers
**Output**: `{ valid: true, engineer_id: "...", engineer_name: "John" }` or `{ valid: false }`

## Component Changes

### `PinDialog.tsx` — Return engineer identity
- Change `onSuccess` callback signature: `onSuccess(engineer: { id: string; name: string })` 
- After valid PIN, show confirmation: "Confirm as: **JOHN DOE**?" with Confirm/Cancel
- Two-step flow: enter PIN → see name → confirm

### `useWorkOrders.ts` — Accept engineer identity
- All status mutation hooks (`useReceiveWorkOrder`, `useArriveWorkOrder`, `useStartWorkOrder`, `useFinishWorkOrder`) accept `{ woId, engineerId, engineerName }` instead of using `auth.uid()`
- `useReceiveWorkOrder`: sets `engineer_id` and `engineer_name` from PIN result
- Each mutation also inserts into `work_order_logs`

### `EngineerDashboard.tsx` — Wire engineer identity through flow
- `requirePin` callback now receives engineer identity
- `handleAcceptClick`, `handleArrivedClick`, `handleStartClick`, `handleFinishClick` all pass `engineerId`/`engineerName` to mutations
- Active WO filtering: show all open WOs (since shared login means all engineers see everything)
- KPIs: query by engineer_id from engineers table, not auth.uid()

### `ManageUsers.tsx` — Engineer CRUD
- Add section to manage engineers (name + PIN) separately from auth users
- Create/edit/delete engineers in the `engineers` table
- PIN set via `set_engineer_pin_standalone` function

## Audit Logging
- `logAuditEvent` updated to accept optional `engineer_id` and `engineer_name` parameters
- All WO actions log both the session user and the PIN-identified engineer

## Files Modified

| File | Change |
|------|--------|
| DB Migration | Create `engineers` table, `work_order_logs` table, `verify_pin_by_code` function, add `engineer_name` to `work_orders` |
| `supabase/functions/verify-engineer-pin/index.ts` | Rewrite to search by PIN across engineers table, return identity |
| `src/components/PinDialog.tsx` | Two-step flow: PIN entry → engineer name confirmation → callback with identity |
| `src/hooks/useWorkOrders.ts` | All status mutations accept engineerId/engineerName, insert into work_order_logs |
| `src/pages/dashboard/EngineerDashboard.tsx` | Wire engineer identity from PinDialog through all action handlers |
| `src/pages/users/ManageUsers.tsx` | Add engineer management section (CRUD for engineers table) |
| `src/hooks/useAuditLogs.ts` | Accept optional engineer identity in logAuditEvent |

## Sequence
1. Database migration (engineers table, work_order_logs, functions, engineer_name column)
2. Rewrite verify-engineer-pin edge function
3. Update PinDialog with two-step confirmation
4. Update useWorkOrders hooks to accept engineer identity
5. Update EngineerDashboard to wire identity through flows
6. Add engineer management to ManageUsers

