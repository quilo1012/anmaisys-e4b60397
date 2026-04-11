

# Fix 6 Production Bugs

## Analysis Summary

| Fix | Root Cause | Effort |
|-----|-----------|--------|
| 1. Engineer PIN Save | Button calls `handleEditEngineer` which works — but user may expect a dedicated "Change PIN" modal. Currently it's inline in the Edit Engineer dialog. The `Save` button works if PIN ≥ 4 digits. **Needs investigation in production vs code.** |
| 2. Clear WOs/Logs PIN | Edge function `verify-admin-pin` actually works correctly (tested: "1234" → valid, "9999" → invalid). Default PIN is "1234". User may be testing with "1234" thinking it should fail. **No code bug — PIN validation works.** |
| 3. Downtime crash | Line 209: `<SelectItem value="">None</SelectItem>` — empty string value crashes Radix Select. |
| 4. Checklist Add | Button is disabled when `!newType` (line 121). User must select a type first. Not obvious UX. Need to make type default to first option or make it optional. |
| 5. Print layout | Print CSS already hides `button`, `header`, `nav`, sidebar elements. The `print:hidden` classes are on Back/Print buttons. May need stronger selectors for the DashboardLayout header element. |
| 6. Analytics Print/PDF | No Print/PDF buttons exist on Analytics page. Need to add them. |

## Changes

### FIX 3 — Downtime Select crash (critical)
**File: `src/pages/dashboard/DowntimePage.tsx` line 209**
- Remove `<SelectItem value="">None</SelectItem>` 
- Add a `value="none"` instead and handle "none" as null in the submit handler

### FIX 4 — Checklist Add button appears broken
**File: `src/pages/dashboard/ProblemsPage.tsx` line 107-121**
- Default `newType` to `"Safety"` instead of empty string so button isn't disabled
- This makes the Add button immediately clickable after typing a description

### FIX 1 — Engineer PIN Save button
**File: `src/pages/users/ManageUsers.tsx` lines 196-213**
- The Save button calls `handleEditEngineer` which does work (updates name, active status, and PIN if ≥ 4 digits)
- Add a toast confirmation specifically for PIN change: "PIN updated for {name}"
- Ensure the dialog closes after save (it does via `setEditEng(null)` on line 207)
- Add `type="button"` to the Save button to prevent form submission issues

### FIX 2 — Clear WOs/Logs PIN validation
The edge function works correctly. The default admin PIN is "1234". 
- Add a clear error message when PIN is invalid: "Invalid security PIN. Action cancelled."
- In `WorkOrdersPage.tsx` and `AuditLogsPage.tsx`, ensure the clear action is blocked when `valid === false`
- Currently both files check `!verifyData?.valid` — this is correct but the toast says "Invalid PIN" which is fine
- **No real bug here** — will add better error feedback

### FIX 5 — Print layout cleanup
**File: `src/index.css`**
- The existing CSS already hides buttons, nav, sidebar, header, breadcrumb
- The DashboardLayout wraps content in a `<main>` inside a flex layout with sidebar — need to ensure the flex parent doesn't constrain print width
- Add selector for the DashboardLayout's header bar: target the specific `<header>` element containing SidebarTrigger
- Ensure `main` takes `100% !important` width and sidebar wrapper is hidden

### FIX 6 — Analytics Print/PDF buttons
**File: `src/pages/dashboard/AnalyticsPage.tsx`**
- Add Print and Export PDF buttons in the page header
- Print: `window.print()`
- PDF: Use `generatePdfReport` or simplified jsPDF export with KPI data
- Add `print:hidden` to the button bar

## Files to modify

| File | Change |
|------|--------|
| `src/pages/dashboard/DowntimePage.tsx` | Fix empty SelectItem value (line 209) |
| `src/pages/dashboard/ProblemsPage.tsx` | Default checklist type to "Safety" |
| `src/pages/users/ManageUsers.tsx` | Better PIN save feedback, type="button" |
| `src/pages/dashboard/AnalyticsPage.tsx` | Add Print/PDF buttons |
| `src/index.css` | Strengthen print CSS for DashboardLayout header |

No database migrations needed.

