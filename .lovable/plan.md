

# Upgrade CMMS/MES — Professional Industrial Maintenance Platform

This is a large-scope upgrade organized into three phases. Each phase builds on the previous one without breaking existing flows.

---

## Phase 1 — Operational Reliability

Most Phase 1 items have already been fixed in prior iterations. Remaining gaps:

### 1A. Parts Used — engineer name from `engineers` table
**Current**: `usePartsUsedByWO` joins `profiles!parts_used_engineer_id_fkey(name)` but `parts_used.engineer_id` is set to `user!.id` (the shared login), not the real engineer. The join resolves the shared login's profile name, not the actual engineer.

**Fix**: Store the real engineer identity in parts_used. Add `engineer_name` text column to `parts_used` table. Populate it at insert time from the current engineer context. Update `PartsUsedDialog` to accept `engineerName` prop and store it. In `WorkOrderDetail`, display `pu.engineer_name` directly.

**Migration**: `ALTER TABLE parts_used ADD COLUMN engineer_name text DEFAULT '';`

### 1B. PartsUsedDialog needs engineer context
**Current**: `PartsUsedDialog` doesn't know which engineer is working. It inserts `engineer_id: user!.id`.

**Fix**: Pass `currentEngineer` (from sessionStorage/PIN) into `PartsUsedDialog`. Store `engineer_name` alongside the insert. This requires a small prop addition.

### 1C. WO Detail page — consistent loading
**Current**: Works correctly. No change needed beyond 1A.

---

## Phase 2 — Industrial Traceability

### 2A. Pause reason
**Current**: Pause sets `paused_at` with no reason.

**Fix**:
- Migration: `ALTER TABLE work_orders ADD COLUMN pause_reason text DEFAULT '';`
- `EngineerDashboard`: Add a small dialog/input when clicking Pause to capture reason.
- `usePauseWorkOrder`: Accept and store `pause_reason`.
- `WorkOrderDetail`: Show pause reason in timeline if present.

### 2B. Work Order timeline — show `work_order_logs`
**Current**: Timeline only shows timestamp fields. The `work_order_logs` table has detailed action logs with engineer names.

**Fix**: In `WorkOrderDetail`, fetch `work_order_logs` for the WO and display them as a detailed action log table (who did what and when). Show in both screen and print.

### 2C. Parts traceability — engineer name in audit
Already addressed by 1A. The `engineer_name` column will be available for audit queries.

### 2D. Master data quality — Problems
**Current**: Already has "Incomplete" badges from prior fix.

**Fix**: Make category selection required (not just a warning). Add a default category list. Block save if category is empty.

### 2E. Master data quality — Machines
**Current**: Already validates name, type, location. Code is optional.

**Fix**: Add code as required field. Show "Incomplete" badge for machines missing code or sector.

---

## Phase 3 — Management & Intelligence

### 3A. Manager Dashboard polish
**Fix**:
- Remove "Total Users" KPI (low value for operations).
- Add "Finished Today" and "Avg MTTR" as more useful KPIs.
- Add quick links for Stock and Audit Logs.
- Clean up spacing and card density.

### 3B. Analytics readability
**Fix**:
- Truncate long machine names in chart labels (max 20 chars).
- Add `%` symbol to SLA compliance display.
- Show "No parts used" percentage more clearly.
- Add tooltips with full names to truncated labels.

### 3C. Machine history — link from Analytics
**Fix**: Make machine names in Analytics charts clickable, linking to `/dashboard/machines/history/{name}`.

### 3D. QR code preparation
**Current**: `MachinesPage` already imports `QRCodeSVG` and has a `qrMachine` state. QR dialog exists.

**Fix**: Ensure QR code encodes a URL like `{origin}/dashboard/machines/history/{machineName}` and the print/download flow works. This is already partially implemented — verify and polish.

---

## Database Migrations

```sql
-- 1. Add engineer_name to parts_used for traceability
ALTER TABLE parts_used ADD COLUMN engineer_name text DEFAULT '';

-- 2. Add pause_reason to work_orders
ALTER TABLE work_orders ADD COLUMN pause_reason text DEFAULT '';
```

## Files Modified

| File | Changes |
|------|---------|
| `src/hooks/useStock.ts` | Add `engineer_name` to insert in `useRegisterPartsUsed` |
| `src/components/PartsUsedDialog.tsx` | Accept `engineerName` prop, pass to mutation |
| `src/pages/dashboard/EngineerDashboard.tsx` | Pass `currentEngineer` to `PartsUsedDialog`; add pause reason dialog |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Show `pu.engineer_name`; fetch and display `work_order_logs`; show pause reason |
| `src/hooks/useWorkOrders.ts` | Add `pause_reason` param to `usePauseWorkOrder` |
| `src/pages/dashboard/ManagerDashboard.tsx` | Replace low-value KPIs; add Stock/Audit quick links |
| `src/pages/dashboard/AnalyticsPage.tsx` | Truncate chart labels; improve readability |
| `src/pages/dashboard/ProblemsPage.tsx` | Make category required |
| `src/pages/dashboard/MachinesPage.tsx` | Add code as required; incomplete badge |
| DB migration | Add `engineer_name` to `parts_used`, `pause_reason` to `work_orders` |

## What is preserved
- PIN-based identity for Accept+Start and Finish (unchanged)
- All RLS policies (unchanged, only additive column)
- Session/route stability (unchanged)
- Existing checklist, photo, and timing logic (unchanged)
- Print/PDF document format (enhanced, not broken)

