

# Improvements: Notifications, Stock Control, and Dashboard Consistency

## 1. Enhanced Alert Sound for Engineers

**Problem**: The current sound is a short, subtle beep that engineers may miss, especially in a noisy factory environment.

**Fix**: Replace the current single-beep sound with a louder, repeating alarm pattern (3 beeps) that is harder to miss. Also add a persistent visual banner at the top of the Engineer Dashboard when there are unacknowledged open WOs.

**File**: `src/lib/shifts.ts` -- rewrite `playAlertSound()` with a more aggressive alarm pattern (3 ascending beeps, louder volume).

## 2. Stock Insufficient Protection (Database Level)

**Problem**: The client-side check in `PartsUsedDialog` prevents submitting if stock is insufficient, but there's no database-level protection. A race condition could allow stock to go negative.

**Fix**: Add a database trigger `validate_stock_before_parts_used` that runs BEFORE INSERT on `parts_used` and raises an exception if `products.quantity < NEW.quantity`.

**Database migration**:
```sql
CREATE OR REPLACE FUNCTION validate_stock_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  available_qty integer;
BEGIN
  SELECT quantity INTO available_qty
  FROM products WHERE id = NEW.product_id;
  
  IF available_qty IS NULL THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  
  IF available_qty < NEW.quantity THEN
    RAISE EXCEPTION 'Insufficient stock. Available: %, Requested: %', available_qty, NEW.quantity;
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_stock
  BEFORE INSERT ON parts_used
  FOR EACH ROW
  EXECUTE FUNCTION validate_stock_availability();
```

## 3. Show Product Line in Parts Used Dialog

**Problem**: When an engineer selects a part, they see `Name (Code) -- Stock: X` but not which **Line** the part belongs to. Since the same part can have different models per line, this is critical.

**Fix**: Update `PartsUsedDialog.tsx` to show the Line in the product selector: `Name (Code) -- Line: X -- Stock: Y`.

## 4. Dashboard Consistency: Remove Duplicate "Work Orders" Nav Item

**Problem**: The sidebar shows both "Dashboard" and "Work Orders" for the Manager, but both link to `/dashboard/manager` -- the same page. This is confusing.

**Fix**: Remove the duplicate "Work Orders" nav item from `DashboardLayout.tsx` since the Manager Dashboard already contains the full work orders table.

## 5. Parts Used in CSV Export

**Problem**: The CSV export doesn't include parts used count.

**Fix**: Add a "Parts Used" column to the CSV export in `exportCsv.ts`. Pass parts counts data to the export function.

---

## Technical Details

### Database Migration
- Add `validate_stock_availability()` function and `trg_validate_stock` BEFORE INSERT trigger on `parts_used`

### Files to Modify

| File | Change |
|------|--------|
| Database | Add stock validation trigger |
| `src/lib/shifts.ts` | Louder, 3-beep alarm pattern |
| `src/components/PartsUsedDialog.tsx` | Show product Line in selector |
| `src/components/DashboardLayout.tsx` | Remove duplicate "Work Orders" nav item |
| `src/lib/exportCsv.ts` | Add "Parts Used" column to CSV |
| `src/pages/dashboard/ManagerDashboard.tsx` | Pass parts counts to CSV export |

