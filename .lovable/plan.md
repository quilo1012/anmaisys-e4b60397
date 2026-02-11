

# Enhancements: Sequential WO Numbers, Manager WO Control, Print, Dynamic Categories, User Edit

This plan addresses all the gaps between the current implementation and the full specification.

---

## 1. Sequential Work Order Number

Add an auto-incrementing `wo_number` (integer) column to `work_orders`. A database sequence generates it automatically on INSERT so each WO gets a unique sequential ID (e.g. WO-0001, WO-0002...).

- Database: add `wo_number` column with a sequence default
- UI: display `WO-XXXX` instead of the truncated UUID everywhere (tables, detail page, exports)

## 2. Manager Can Create, Edit, and Delete Work Orders

Currently only operators can create WOs. This adds:

- **Create**: Manager dashboard gets a "Create WO" form (same as operator's). RLS policy updated so admins can also INSERT.
- **Edit**: Manager can edit line, machine, and description of any WO (dialog on the WO table). RLS already allows admin UPDATE.
- **Delete**: Manager can delete any WO (with confirmation). New RLS policy for DELETE by admin.

## 3. Print Work Order

Add a "Print" button on the Work Order Detail page that uses `window.print()` with a print-friendly CSS layout. The printed view shows:
- WO number, line, machine, description
- Timeline (created, started, completed)
- Operator, Engineer, Closer names
- Parts used table
- Response time and total time

A print-specific CSS media query hides the sidebar and navigation.

## 4. Dynamic Stock Categories

Replace the hardcoded category dropdown with manager-defined categories stored in the database.

- Database: new `product_categories` table (id, name, created_at)
- RLS: admin can CRUD; engineers can SELECT
- UI: Stock page shows category management section for managers (add/delete categories). The category dropdown in product forms pulls from the database instead of hardcoded values.

## 5. User Edit and Deactivate

Add edit and deactivate capabilities to the ManageUsers page:

- **Edit**: Dialog to update name, role, shift, and active status. Uses the existing edge function pattern (new `update-user` edge function using service role key for role changes).
- **Deactivate/Activate**: Toggle the `active` field on profiles. Deactivated users remain in the system but their sessions should be considered invalid.

---

## Technical Details

### Database Migration

```sql
-- 1. Sequential WO number
CREATE SEQUENCE IF NOT EXISTS wo_number_seq START 1;
ALTER TABLE work_orders ADD COLUMN wo_number integer 
  NOT NULL DEFAULT nextval('wo_number_seq');
CREATE UNIQUE INDEX idx_wo_number ON work_orders(wo_number);

-- 2. Allow admin to INSERT and DELETE WOs
CREATE POLICY "Admins can create WOs" ON work_orders
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete WOs" ON work_orders
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- 3. Product categories table
CREATE TABLE product_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage categories" ON product_categories
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE POLICY "Engineers can view categories" ON product_categories
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'engineer'));

-- Seed existing categories
INSERT INTO product_categories (name) VALUES ('BFM'), ('spare'), ('consumable');
```

### New Edge Function: `update-user`

Handles profile updates (name, shift, active) and role changes via the service role key. Verifies the caller is an admin before making changes.

### Files to Create
- `supabase/functions/update-user/index.ts` -- edge function for user updates
- `src/hooks/useCategories.ts` -- hook for fetching/managing product categories

### Files to Modify
- `src/hooks/useWorkOrders.ts` -- add `wo_number` to the WorkOrder interface and queries; add `useDeleteWorkOrder` and `useUpdateWorkOrder` hooks
- `src/pages/dashboard/ManagerDashboard.tsx` -- add Create WO form, Edit/Delete actions on WO table, show `wo_number`
- `src/pages/dashboard/OperatorDashboard.tsx` -- display `wo_number` in table
- `src/pages/dashboard/EngineerDashboard.tsx` -- display `wo_number` in table
- `src/pages/dashboard/WorkOrderDetail.tsx` -- display `wo_number`, add Print button with print-friendly styles
- `src/pages/dashboard/StockPage.tsx` -- replace hardcoded categories with dynamic ones from DB, add category management UI for managers
- `src/pages/users/ManageUsers.tsx` -- add Edit and Deactivate buttons/dialogs per user row
- `src/components/PartsUsedDialog.tsx` -- no changes needed
- `src/lib/exportCsv.ts` -- add `wo_number` column to CSV export
- `src/index.css` -- add `@media print` styles to hide sidebar/header

### Summary of Changes by Feature

| Feature | DB | Edge Fn | UI Files |
|---------|-----|---------|----------|
| Sequential WO# | sequence + column | -- | all dashboards, detail, CSV |
| Manager CRUD WOs | 2 RLS policies | -- | ManagerDashboard |
| Print WO | -- | -- | WorkOrderDetail, index.css |
| Dynamic Categories | new table + RLS | -- | StockPage, new hook |
| User Edit/Deactivate | -- | update-user | ManageUsers |

