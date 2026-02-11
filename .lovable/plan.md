
# Fix: Notifications, Product Line Field, and WO Time Display

## Issue 1: Engineer Notifications Not Working

**Root cause**: Two problems found:
- The `notified_engineers` update always starts from an empty array (`[...([] as string[]), user.id]`) instead of appending to the existing list from the payload.
- The manager has no way to verify notifications are being sent. We'll add a visual confirmation toast on the manager side when a WO is created ("WO created -- engineers on shift will be notified").

**Fix in `src/hooks/useWOAlerts.ts`**:
- Read the existing `notified_engineers` array from `payload.new` and append the current user's ID to it.
- This ensures the list accumulates all notified engineers instead of resetting.

**Fix in `src/pages/dashboard/ManagerDashboard.tsx`**:
- After successful WO creation, show a more descriptive toast: "Work Order Created -- Engineers on shift will receive a sound notification."

## Issue 2: Add "Line" Field to Products

**Database change**: Add a `line` column (text, nullable, default empty) to the `products` table so the same part can be distinguished by which production line it belongs to.

**UI changes in `src/pages/dashboard/StockPage.tsx`**:
- Add a "Line" input field in both the Add Product and Edit Product forms.
- Add a "Line" column in the products table between Name and Code.

**Hook changes in `src/hooks/useStock.ts`**:
- Update the `Product` interface to include `line: string`.
- Update `useAddProduct` and `useUpdateProduct` to include the `line` field.

## Issue 3: Show Engineer Start/End Times in WO Tables

The detail page already shows the timeline correctly. The problem is that the **table views** on Manager, Engineer, and Operator dashboards only show "Created" time.

**Changes to all three dashboard tables**:
- Add "Started" and "Completed" columns to the WO tables.
- Display `started_at` and `completed_at` formatted as `dd/MM HH:mm`, or "--" if null.

Files affected:
- `src/pages/dashboard/ManagerDashboard.tsx` -- add Started/Completed columns
- `src/pages/dashboard/EngineerDashboard.tsx` -- add Started/Completed columns
- `src/pages/dashboard/OperatorDashboard.tsx` -- add Started/Completed columns

---

## Technical Details

### Database Migration
```sql
ALTER TABLE products ADD COLUMN line text NOT NULL DEFAULT '';
```

### Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useWOAlerts.ts` | Fix notified_engineers append logic |
| `src/hooks/useStock.ts` | Add `line` to Product interface, add/update mutations |
| `src/pages/dashboard/StockPage.tsx` | Add Line field in forms and table |
| `src/pages/dashboard/ManagerDashboard.tsx` | Add Started/Completed columns, improve create toast |
| `src/pages/dashboard/EngineerDashboard.tsx` | Add Started/Completed columns |
| `src/pages/dashboard/OperatorDashboard.tsx` | Add Started/Completed columns |
