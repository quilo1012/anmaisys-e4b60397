

# Plan: Remove Risk, Checklist, Fix Reliability Filters, Remove Print Logo

## Changes

### 1. Remove Risk Level from Problems Page (`src/pages/dashboard/ProblemsPage.tsx`)
- Remove `RISK_LEVELS` constant, `riskBadgeClass` function
- Remove Risk Level `<Select>` from `formContent` (lines 213-219)
- Remove `severity` state and `setSeverity` from `resetForm`
- Remove Risk Level column from table header and body (lines 252, 268-271)
- Keep `severity` in data model (DB unchanged), just hide from UI

### 2. Remove Checklist from Problems Page (`src/pages/dashboard/ProblemsPage.tsx`)
- Remove `ChecklistManager` component entirely (lines 36-127)
- Remove checklist imports (`useChecklistsByProblem`, `useAddChecklist`, `useDeleteChecklist`, `ChecklistItem`, `ClipboardList`)
- Remove `{editProblem && <ChecklistManager problemId={editProblem.id} />}` from edit dialog (line 310)
- Remove "and checklists" from description text (line 235)

### 3. Fix Reliability Dashboard Filters (`src/pages/dashboard/ReliabilityDashboard.tsx`)
- The `filteredRisks` only filters by machine/line but NOT by date range — `machineRisks` from `usePredictiveAlerts` always uses last 30 days hardcoded
- Fix: filter `filteredWOs` is correct (uses date range), but the risk table ignores the date picker since `usePredictiveAlerts` is hardcoded to 30 days
- Solution: compute risks locally from `filteredWOs` instead of using the hook's `machineRisks`, so the date range filter actually applies to the risk table

### 4. Remove Logo from Print (`src/pages/dashboard/WorkOrderDetail.tsx`)
- Remove the logo `<img>` from the print header (line 202)
- Remove the watermark block (lines 193-196)
- Keep the text header "AN MAINTENANCE" and "WORK ORDER"
- Also remove `import appliedLogo` if no longer used in the file

### Files affected:
| File | Change |
|------|--------|
| `src/pages/dashboard/ProblemsPage.tsx` | Remove Risk Level UI + Checklist UI |
| `src/pages/dashboard/ReliabilityDashboard.tsx` | Compute risks from filtered WOs (respects date picker) |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Remove logo from print header + watermark |

