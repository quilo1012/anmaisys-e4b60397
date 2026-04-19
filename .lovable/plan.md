

The user wants the footer copyright year on the Login page to be dynamic. Looking at `src/pages/Login.tsx`, line 60 already has `const year = new Date().getFullYear();` and line 215 uses `© {year} Applied Nutrition Ltd.` — so the Login page footer is already dynamic.

The hardcoded "2026" must be elsewhere. Let me search for it.

## Plan

Search the codebase for hardcoded `2026` in copyright/footer contexts and replace with `{new Date().getFullYear()}`.

### Steps
1. Run `code--search_files` for `2026` and `©` to locate all hardcoded year references in JSX/footer contexts.
2. For each match in a footer/copyright context, replace `2026` with `{new Date().getFullYear()}` (inline) — no need for a `const year` variable unless one already exists in that file.
3. Skip non-footer occurrences (e.g., default date ranges, demo data, comments, WO numbering format `WO-YYYY-000XXX`).

### Files likely affected
- `index.html` (static footer/meta)
- Any dashboard layout, public landing, or print/PDF templates (`generatePdfReport.ts`, `WorkOrderDetail.tsx`)

Exact file list confirmed after the search in implementation mode.

### Verification
- Grep for `2026` returns zero hits in copyright/footer contexts.
- Login page footer still renders correctly (already dynamic).
- Print/PDF outputs show current year in their footer.

