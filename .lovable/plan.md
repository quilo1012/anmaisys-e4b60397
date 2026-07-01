Apply three small UI fixes in one pass.

## FIX #2 — Analytics KPI typography
File: `src/pages/dashboard/AnalyticsPage.tsx` (project uses `AnalyticsPage.tsx`, not `Analytics.tsx`).
- Audit KPI value elements and normalize any `text-2xl`/`text-4xl`/other sizes on KPI numbers to `text-3xl font-bold`.
- Leave labels, layout, and card styling untouched.

## FIX #3 — Operator Panel emojis
File: `src/pages/dashboard/OperatorDashboard.tsx` (and `OperatorPreviewPage.tsx` if it renders the same UI).
- Remove emoji characters (🔴 ⚠️ 🏭 🖨️ ✅ and any others) from button labels and badge text.
- Substitute with lucide-react icons where appropriate: `AlertCircle` for warnings/red alerts, `Factory` for production/line, `Printer` for printer, `CheckCircle2` for success/OK.
- Preserve button `onClick`, variants, sizes, and all behavior.

## FIX #4 — Destructive button variants
- `src/pages/dashboard/AuditLogsPage.tsx`: change the "Clear Audit Logs" button from `variant="outline"` to `variant="destructive"` (remove the custom destructive-colored outline classes since the variant handles it).
- Grep the app for delete/clear/remove buttons using `variant="outline"` or `variant="default"` and switch to `variant="destructive"` where the action is destructive (e.g. delete user, delete engineer, delete supplier, clear system, remove line, delete WO). Icon-only trash buttons already using `ghost` for row actions stay as-is unless they clearly represent a primary destructive CTA.

No logic, routing, or data changes. Verification: read modified files after edits and confirm typecheck passes via the harness.
