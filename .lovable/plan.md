

# Phase 9: Cost Visibility Restrictions and Photo Flow

## 1. Hide Costs from Engineers and Operators

Only **admin/manager** sees cost information. Engineers and operators see no prices anywhere.

**WorkOrderDetail.tsx:**
- Import `useAuth` and check `role === 'admin'`
- Wrap the entire "Cost Breakdown" card in a role check — only render for admin
- Remove `DollarSign` import usage for non-admin
- Hide price column from parts_used table for non-admin (remove the cost-related queries entirely for non-admin)

**FinancialDashboard.tsx:** Already admin-only (route protected), no changes needed.

**StockPage.tsx:** Check if price column is visible to engineers — if so, hide it for non-admin roles.

## 2. Photo Flow: Before on Start, After on Finish

Currently photos are both available during `in_progress` status. Change to:

**EngineerDashboard.tsx:**
- When engineer clicks **START**: show a dialog/prompt asking for a "Before" photo. Allow skip with a reminder toast ("Don't forget to add a Before photo later!")
- When engineer clicks **FINISH**: show a dialog/prompt asking for an "After" photo. Allow skip with a reminder toast ("Don't forget to add an After photo!")
- Remove the hard block (`if (!photos?.before || !photos?.after)`) — photos are no longer mandatory
- Keep the photo upload buttons during `in_progress` for manual uploads at any time

**Flow:**
1. Engineer clicks START → Before Photo dialog appears → Upload or Skip (toast reminder)
2. WO moves to `in_progress` with photo buttons still available
3. Engineer clicks FINISH → After Photo dialog appears → Upload or Skip (toast reminder)  
4. Then pre/post checklist and signature flow continues as before

## Files Modified

| File | Change |
|------|--------|
| `WorkOrderDetail.tsx` | Hide Cost Breakdown for non-admin, hide price in parts table |
| `EngineerDashboard.tsx` | Before photo prompt on START, After photo prompt on FINISH, remove mandatory block |
| `WorkOrderDetail.tsx` | Add `useAuth` import for role check |

## Sequence
1. Cost visibility restriction (WorkOrderDetail)
2. Photo flow restructure (EngineerDashboard)

