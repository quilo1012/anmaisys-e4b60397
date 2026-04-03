
Goal: fix only the remaining Work Order print/PDF bug by making the shared Work Order detail page produce one clean saved-data-only printable document for both Engineer and Manager.

What I’ll change

1. Keep one single printable WO source
- Use `src/pages/dashboard/WorkOrderDetail.tsx` as the only printable template for both roles.
- Do not create a second print view or separate manager/engineer template.
- Keep the existing shared `/dashboard/wo/:id` route as the print source.

2. Normalize printable values to saved data only
- In `WorkOrderDetail.tsx`, derive print-safe values from the loaded database record:
  - engineer name: `wo.engineer_name || wo.engineer?.name || ""`
  - operator name: `wo.operator?.name || ""`
  - requester/notes/signature dates/etc.: real saved value or `""`
- Remove printable fallbacks like:
  - `"Engineer"`
  - `"—"`
  - underscore placeholders
  - invented date placeholders

3. Fix printable Parts Used output
- In the printed WO, render engineer name for each part row as:
  - `pu.engineer?.name`
  - else `wo.engineer_name`
  - else `""`
- Also leave product/code blank if missing instead of showing placeholder text.

4. Keep both printable signature sections
- Preserve:
  - `Engineer Signature`
  - `Operator Signature`
- Pre-fill only with real saved values.
- If name/date is missing, leave that field blank.

5. Print only the WO document
- Keep screen controls hidden in print.
- Ensure print-visible content is only the Work Order document block.
- If needed, tighten `src/index.css` print selectors so no layout chrome leaks into print from dashboard wrappers.

6. Do not touch unrelated areas
- No refactor of work order flows, auth, dashboard logic, or non-print pages.
- No database changes.
- No changes to non-WO reports.

Files expected
- `src/pages/dashboard/WorkOrderDetail.tsx`
- `src/index.css` only if current print CSS still allows non-document UI to appear

Technical details
- Main issue still visible in the current file:
  - printable fields still contain placeholders like `"—"` and signature placeholder text
  - Parts Used currently mixes real data with fallback placeholders
  - print correctness depends on a mix of shared screen/print elements
- The fix is to make every print-visible field read from normalized saved values and render blank when absent, while preserving the existing screen behavior as much as possible.
