

# Plan: Reliability Machine History, Print Logo, Downtime Blank Fields

## Changes

### 1. Reliability Dashboard — Add Machine Problem History (`src/pages/dashboard/ReliabilityDashboard.tsx`)
- Add period selector tabs: **Today / This Week / This Month / Custom** (similar to analytics)
- Add a new section "Machine Problem History" showing a table of machines ranked by problem count for the selected period
- Each row shows: machine name, problem count (today), problem count (week), problem count (month), top problem description
- This gives visibility into which machine had most problems daily/weekly/monthly

### 2. Print Logo — Restore in WO Print Header (`src/pages/dashboard/WorkOrderDetail.tsx`)
- Add the `appliedLogo` image back to the print-only header (line 196 area)
- Import `appliedLogo` if not already imported
- Place it before "AN MAINTENANCE" text in the print header

### 3. Downtime — All Fields Blank on Create (`src/pages/dashboard/DowntimePage.tsx`)
- In `openCreate()` (line 56-59), remove `setFormStartedAt(new Date().toISOString().slice(0, 16))` so start time is blank
- All fields will already be blank from `resetForm()` — just remove the auto-fill of start time

## Files Changed
| File | Change |
|------|--------|
| `src/pages/dashboard/ReliabilityDashboard.tsx` | Add machine problem history table with daily/weekly/monthly counts |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Restore logo in print header |
| `src/pages/dashboard/DowntimePage.tsx` | Remove auto-fill of start time on create |

