

# Phase 5: Polish and Adjustments

## 1. Configurable Admin PIN (not hardcoded)

**Database:** Create `system_settings` table with a single row containing `admin_pin` (text, default '1234').

**Manager Dashboard:** Add a small "Change PIN" section where admin can update the PIN. The `handleClearSystem` function validates against the DB value instead of hardcoded '1234'.

## 2. Move "Clear" to Work Orders Page (not whole system)

Remove the "Clear System" button from `ManagerDashboard.tsx`. Add a "Clear All Work Orders" button to `WorkOrdersPage.tsx` (admin only). The edge function already deletes only WO-related data (messages, photos, parts_used, work_orders, engineer_scores), so it stays as-is.

## 3. Fix Print Layout

**`src/index.css`:** Strengthen `@media print` rules — force-hide `[data-sidebar]`, `header`, `nav`, `.no-print`, and all buttons. Only `.print-content` is visible.

**`WorkOrderDetail.tsx`:** Add a "Requested By Signature" line at the bottom of the print layout — a blank signature line with the requester's name so they can sign the printed document.

## 4. Stock Value on Financial Dashboard

**`FinancialDashboard.tsx`:** Add a card "Stock Inventory Value" that calculates `SUM(price × quantity)` from the already-fetched `products` data and displays the total.

## 5. Verify Mobile Engineer Layout

Test Engineer Dashboard at 375px viewport width to confirm cards and buttons render properly.

---

## Files Modified

| File | Change |
|------|--------|
| Migration SQL | Create `system_settings` table |
| `ManagerDashboard.tsx` | Remove Clear System button, add Change PIN UI |
| `WorkOrdersPage.tsx` | Add Clear WOs button (admin), use DB PIN |
| `WorkOrderDetail.tsx` | Add requester signature line for print |
| `FinancialDashboard.tsx` | Add stock inventory value card |
| `src/index.css` | Strengthen print CSS |

## Sequence
1. Database migration (system_settings)
2. Move Clear WOs + configurable PIN
3. Print fix + signature line
4. Stock value card
5. Mobile verification

