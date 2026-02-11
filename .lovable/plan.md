

# Product Edit/Delete + CSV Date Filter

## 1. Product Edit & Delete (Stock Page)

Add manager-only "Edit" and "Delete" action buttons to each product row in the stock table.

### Edit Product
- Clicking "Edit" opens a dialog pre-filled with the product's current name, code, category, quantity, and min_stock
- Manager can modify any field and save
- Uses a new `useUpdateProduct` mutation hook that calls `supabase.from("products").update(...)` (RLS already allows admin UPDATE/DELETE)

### Delete Product
- Clicking "Delete" shows a confirmation dialog (AlertDialog) asking "Are you sure?"
- Uses a new `useDeleteProduct` mutation hook that calls `supabase.from("products").delete().eq("id", id)`
- RLS already has "Admins can delete products" policy in place

### Files modified:
- `src/hooks/useStock.ts` -- add `useUpdateProduct` and `useDeleteProduct` hooks
- `src/pages/dashboard/StockPage.tsx` -- add Actions column to table, Edit dialog, Delete confirmation dialog

## 2. Date Range Filter for CSV Export (Manager Dashboard)

Add "From" and "To" date inputs next to the Export CSV button. When exporting, only WOs created within the selected range are included.

- Two date input fields (HTML date inputs for simplicity) placed inline with the export button
- If no dates are selected, export all WOs (current behavior)
- Filter is applied client-side on the already-loaded `workOrders` data before passing to `exportWorkOrdersCsv()`

### Files modified:
- `src/pages/dashboard/ManagerDashboard.tsx` -- add date state, filter logic, date inputs in the toolbar

---

## Technical Details

### New hooks in `useStock.ts`:

**useUpdateProduct:**
```
mutationFn: ({ id, name, code, quantity, min_stock, category }) =>
  supabase.from("products").update({ name, code, quantity, min_stock, category }).eq("id", id)
```

**useDeleteProduct:**
```
mutationFn: (id) => supabase.from("products").delete().eq("id", id)
```

### StockPage changes:
- Add an "Actions" column (visible only for managers) with Edit (Pencil icon) and Delete (Trash icon) buttons
- Edit dialog uses the existing Dialog component, pre-filled with product data
- Delete uses AlertDialog for confirmation
- Both invalidate the "products" query on success

### ManagerDashboard changes:
- Add `dateFrom` and `dateTo` state (string, initially empty)
- Filter `workOrders` by `created_at` range before passing to `exportWorkOrdersCsv()`
- Render two `<Input type="date" />` fields next to the Export button

