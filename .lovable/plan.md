

# Fix Operator Dashboard: Blank Fields + Retroactive Date/Time

## Issues

1. **Form fields not blank**: The "Requested By" field shows `profile?.name` even before user interaction. Line/Machine/Description selects work correctly with placeholders, but the requester field is pre-filled and read-only.

2. **No retroactive date option**: Operators cannot create work orders with a past date/time. The `created_at` always defaults to `now()` in the database.

## Changes

### File: `src/pages/dashboard/OperatorDashboard.tsx`

1. **Requester field** — Keep it read-only showing `profile?.name` (this is correct behavior per memory — ensures integrity). No change needed here since the user identity should be auto-filled.

2. **Add retroactive date/time fields**:
   - Add a `Switch` or `Checkbox` labeled "Retroactive Order" that reveals date and time inputs
   - When enabled, show a date picker (using `Popover` + `Calendar`) and a time input (`<Input type="time">`)
   - Default: unchecked (uses current date/time as normal)
   - When checked: user selects past date and time

3. **Pass `created_at` to mutation** when retroactive is enabled

### File: `src/hooks/useWorkOrders.ts`

- Extend `useCreateWorkOrder` mutation to accept optional `created_at` field
- Pass it through to the Supabase insert: `created_at: wo.created_at || undefined`

### File: `src/pages/dashboard/OperatorDashboard.tsx` — Field defaults

- All Select fields already start empty with placeholders — confirmed working
- `notes` starts as `""` — correct
- The "Requested By" field is intentionally read-only with the logged-in user's name (per design requirement for data integrity)

## Summary of UI additions

- New toggle: "Retroactive Order" (Switch component)
- When on: date picker + time input appear in the form grid
- Submit sends the custom `created_at` timestamp to the database

No database migration needed — `created_at` column already accepts explicit values on insert.

