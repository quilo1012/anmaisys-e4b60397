# Plan

## What I found
There are two different errors being mixed together:

1. Operator password create/reset is failing because leaked-password protection is active in the backend, so weak/reused passwords are rejected.
2. Work order creation for operators is still blocked by database rules that require the request to match `current_device_line_ids()`, which depends on the `x-device-token` header. The current app no longer sends that header and instead uses `operator_line_accounts` + logged-in user mapping.

That is why it feels like “the same error all the time”: one issue is password policy, the other is work order authorization.

## Implementation steps

### 1. Fix operator account password UX
Update `src/components/OperatorAccountsSection.tsx` to prevent obvious bad passwords before submit:
- add clear password guidance in create/reset dialogs
- block common weak formats before calling the backend
- show backend rejection text directly when the backend rejects a leaked password

This keeps the security protection on, but stops the admin flow from feeling random.

### 2. Fix operator work-order creation to match the current identity model
Update the database access logic so operator work-order INSERT does not rely on device-header pairing that the app no longer uses.

Preferred fix:
- add a new `INSERT` policy for `work_orders` that allows operators to create when:
  - `operator_id = auth.uid()`
  - the chosen `line_id` is inside that user’s `operator_line_accounts.line_ids`
- remove the old operator INSERT policy that depends on `current_device_line_ids()` for creation

This matches the current app flow:
```text
operator login -> operator_line_accounts row -> allowed line_ids -> selected line -> create WO
```

### 3. Keep operator read scoping consistent
Review `SELECT` scoping for operator work orders so it also aligns with account-based line permissions, not only device-token headers.

If needed, adjust operator `SELECT` policies to allow:
- own work orders
- work orders on lines assigned to the logged-in operator account

This avoids future mismatches where create works but list/read fails.

### 4. Fix the Requested By field at the same time
Update `src/pages/dashboard/OperatorDashboard.tsx` so `Requested By` starts empty and remains manually editable, using the existing combobox/suggestion pattern instead of the rigid select.

This restores the intended operator workflow and removes the autofill-like behavior.

### 5. Apply the approved Blender cleanup
Create a database migration that:
- rewrites historical `work_orders.line_at_time` containing “Blender” to `Removed`
- deletes Blender-related lines
- deletes or detaches Blender-linked machines safely according to existing references

I will verify references before finalizing the migration so it does not break foreign-key or app assumptions.

### 6. Validate end-to-end
After implementation, test these flows:
- create operator account with a strong password
- reset one operator password with a strong password
- log in as operator
- create a work order on an allowed line
- confirm the new work order appears in the operator list

## Files likely involved
- `src/components/OperatorAccountsSection.tsx`
- `src/pages/dashboard/OperatorDashboard.tsx`
- `src/hooks/useWorkOrders.ts` (only if small client-side error handling needs improvement)
- new database migration for `work_orders` operator RLS and Blender cleanup

## Technical details
- Current `work_orders` INSERT policy is: `operator_id = auth.uid() AND line_id = ANY(current_device_line_ids())`
- `current_device_line_ids()` reads from `request.headers -> x-device-token`
- the frontend client does not send `x-device-token`
- `OperatorLineGuard` now derives allowed lines from `operator_line_accounts`, not device tokens
- leaked-password protection is documented backend behavior and should remain enabled per your decision to keep strong password protection

## Outcome
After this change:
- strong operator passwords will save reliably
- weak/leaked passwords will fail with a clearer reason
- operator work orders will stop failing because authorization will match the real login model
- the `Requested By` field will stop coming prefilled incorrectly
- Blender entries will be removed as requested