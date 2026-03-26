

# Phase 4: Cost System, Financial Dashboard, Demo Mode

## What's genuinely new (not already built)

Everything else in the prompt (WO pipeline, alerts, checklist, photos, signature, print CSS, CSV export, chat, heatmap, control center, ranking, filters, LINE column) is already implemented and working.

---

## 1. Cost Tracking System

**Database migration:**
- Add `price` column (numeric, default 0) to `products` table
- Add `labor_rate` column (numeric, default 0) to `profiles` table (hourly rate per engineer)

**Cost calculation** (computed client-side per WO):
- **Parts cost**: SUM(product.price * parts_used.quantity) for each WO
- **Labor cost**: repair_hours * engineer's labor_rate (repair_hours = difference between started_at and finished_at)
- **Overtime cost**: hours beyond 8h shift * 1.5x labor_rate
- **Total**: parts + labor + overtime

**Files:**
- Migration SQL: add `price` to products, `labor_rate` to profiles
- `src/hooks/useStock.ts`: Update Product interface to include `price`
- `src/pages/dashboard/StockPage.tsx`: Add price field to product form
- `src/pages/dashboard/WorkOrderDetail.tsx`: Add cost breakdown card showing parts cost, labor cost, overtime, total

---

## 2. Financial Dashboard

**New page:** `src/pages/dashboard/FinancialDashboard.tsx`
**Route:** `/dashboard/financial`

Cards:
- Total cost today / this month
- Cost by machine (bar chart)
- Cost by line (bar chart)
- Table of WOs with cost breakdown

Data computed from existing `work_orders` + `parts_used` + `products` (with new price field).

**Files:**
- `src/pages/dashboard/FinancialDashboard.tsx` (NEW)
- `src/App.tsx`: Add route
- `src/components/DashboardLayout.tsx`: Add "Financial" to sidebar for admin

---

## 3. Demo Mode: Clear All Work Orders

**Edge function:** `supabase/functions/clear-system/index.ts`
- Deletes all `wo_messages`, `wo_photos`, `parts_used`, `work_orders` in order (respecting dependencies)
- Requires admin role (verified via service role key + user check)

**UI:**
- `src/pages/dashboard/ManagerDashboard.tsx`: Add "Clear System" button with confirmation dialog
- Only visible to admin role

---

## 4. Remove Severity from Problems

**File:** `src/pages/dashboard/ProblemsPage.tsx`
- Remove severity Select from create/edit form
- Remove severity column from table
- Remove `severityColors` config

**File:** `src/hooks/useProblemDescriptions.ts`
- Remove severity from add/update mutations

---

## 5. Financial Summary in PDF Report

**File:** `src/lib/generatePdfReport.ts`
- Add financial section after KPIs: total parts cost, total labor cost, total overtime cost, grand total
- Update `ReportData` interface to include cost fields

**File:** `src/pages/dashboard/WorkOrdersPage.tsx`
- Pass cost data to `generatePdfReport()`

---

## Implementation Sequence

1. Database migration (price on products, labor_rate on profiles)
2. Remove severity from ProblemsPage
3. Cost calculation in WorkOrderDetail
4. Financial Dashboard page + route + sidebar
5. Clear System edge function + UI button
6. PDF report with financial summary

## Files Summary

| File | Action |
|------|--------|
| Migration SQL | Add `price` to products, `labor_rate` to profiles |
| `supabase/functions/clear-system/index.ts` | NEW -- bulk delete all WOs |
| `src/pages/dashboard/FinancialDashboard.tsx` | NEW -- cost charts and tables |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Add cost breakdown card |
| `src/pages/dashboard/ManagerDashboard.tsx` | Add Clear System button |
| `src/pages/dashboard/ProblemsPage.tsx` | Remove severity field |
| `src/pages/dashboard/StockPage.tsx` | Add price field |
| `src/hooks/useStock.ts` | Add price to Product interface |
| `src/hooks/useProblemDescriptions.ts` | Remove severity |
| `src/lib/generatePdfReport.ts` | Add financial summary |
| `src/pages/dashboard/WorkOrdersPage.tsx` | Pass cost data to PDF |
| `src/App.tsx` | Add financial route |
| `src/components/DashboardLayout.tsx` | Add Financial to sidebar |

