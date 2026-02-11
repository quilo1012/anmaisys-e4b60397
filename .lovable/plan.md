

# Phase 3 & 4 -- Stock/Inventory + Reports & KPIs

This plan covers the remaining features: inventory management with automatic stock reduction, parts usage tracking, engineer KPIs, manager reports, and CSV export.

---

## Phase 3: Stock & Inventory

### Database Changes

**New table: `products`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | auto-generated |
| name | text | part name |
| code | text (unique) | part code |
| quantity | integer | current stock, default 0 |
| min_stock | integer | minimum threshold, default 0 |
| category | text | 'BFM', 'spare', or 'consumable' |
| created_at | timestamptz | auto |
| updated_at | timestamptz | auto |

**New table: `parts_used`**
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | auto-generated |
| work_order_id | uuid | FK to work_orders |
| product_id | uuid | FK to products |
| quantity | integer | amount used |
| engineer_id | uuid | who registered it |
| created_at | timestamptz | auto |

**RLS Policies:**
- `products`: Engineers can SELECT; Managers can SELECT, INSERT, UPDATE, DELETE
- `parts_used`: Engineers can SELECT and INSERT (own records); Managers can SELECT all

**Database trigger:** On `parts_used` INSERT, automatically reduce `products.quantity` by the amount used.

### New Pages

**Stock Page (`/dashboard/stock`)**
- Table listing all parts: name, code, quantity, min_stock, category
- Visual warning (red highlight) when quantity is at or below min_stock
- Manager-only section: Add new product form and manual stock adjustment (+/- quantity)
- Engineers see read-only stock view

**Parts Registration (Engineer Dashboard enhancement)**
- When an engineer completes a WO, they can register parts used before marking complete
- Dialog/form: select product, enter quantity
- Stock is reduced automatically via database trigger

### Updated Pages

**Work Order Detail** (`/dashboard/wo/:id`)
- Replace the Phase 3 placeholder with actual parts used list
- Show product name, quantity used, engineer name, timestamp

**Engineer Dashboard**
- Add "Register Parts" button on in-progress WOs (opens parts dialog)

---

## Phase 4: Reports & KPIs

### Engineer KPIs (Engineer Dashboard)

New stats cards:
- Total WOs completed (all time)
- Average Response Time (time from created to started)
- Average MTTR (Mean Time To Repair: started to completed)
- Total parts used

Computed by querying completed WOs where `engineer_id = current user`.

### Manager Dashboard Enhancements

**KPI Summary Cards (enhanced):**
- Average Response Time (all engineers)
- Average MTTR (all engineers)
- Total parts consumed today
- Low stock alerts count

**Charts (using Recharts, already installed):**
- Bar chart: WOs per day (last 7 days)
- Bar chart: Top 5 machines by WO count

### CSV Export (Manager)

- "Export" button on the Work Orders table
- Generates CSV with: Line, Machine, Description, Status, Operator, Engineer, Created, Started, Completed, Response Time, Total Time
- Date range filter before export

---

## Technical Details

### Files to create:
- `src/pages/dashboard/StockPage.tsx` -- full stock management page
- `src/hooks/useStock.ts` -- queries/mutations for products and parts_used
- `src/components/PartsUsedDialog.tsx` -- dialog for engineers to register parts
- `src/lib/exportCsv.ts` -- CSV generation utility

### Files to modify:
- `src/App.tsx` -- add `/dashboard/stock` route
- `src/components/DashboardLayout.tsx` -- stock nav already exists, just verify routing
- `src/pages/dashboard/EngineerDashboard.tsx` -- add KPI cards, parts registration button
- `src/pages/dashboard/ManagerDashboard.tsx` -- add charts, enhanced KPIs, export button
- `src/pages/dashboard/WorkOrderDetail.tsx` -- show actual parts used instead of placeholder

### Database migration:
- Create `products` and `parts_used` tables with RLS
- Create trigger function to auto-reduce stock on parts_used INSERT
- Enable realtime on `products` (for live stock updates)

