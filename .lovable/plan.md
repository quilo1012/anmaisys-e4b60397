## Scope

Ship the 7 files described, in 3 layers.

### Layer 1 — UI polish (no backend)
- `src/pages/dashboard/ReliabilityDashboard.tsx` — redesign KPI cards with colored icons (Activity/AlertTriangle/Clock/Cog/TrendingUp), add a machine × weekday failure heatmap (green→amber→red), convert Machine Problem History table to mobile-friendly cards on `<md`, harden badges for dark mode.
- `src/pages/dashboard/WorkOrderDetail.tsx` — photos in a 2×2 grid when >1, header photo counter, hover "View full" overlay, dashed placeholder when no photos.

### Layer 2 — Microsoft Teams integration
- `supabase/functions/notify-teams/index.ts` — POSTs Adaptive Cards to `TEAMS_WEBHOOK_URL` for: new critical WO, WO unassigned >30min, line stopped, line resumed. CORS + zod validation + `verify_jwt = false` (config already auto).
- `src/components/TeamsSetupCard.tsx` — Settings card: status of `TEAMS_WEBHOOK_URL` secret + "Send test card" button calling the function.
- Mount card in `src/pages/dashboard/SettingsPage.tsx` under an "Integrations" section.

### Layer 3 — Weekly email reports
- `supabase/functions/send-weekly-report/index.ts` — aggregates last 7d KPIs (WOs opened/closed, MTTR, MTBF, top 5 problem machines, PMs due), renders HTML, sends via Resend (`RESEND_API_KEY`), optionally posts summary to Teams.
- `src/components/WeeklyReportCard.tsx` — Settings card: recipient email input + "Send now" button + pg_cron snippet copy-button for weekly automation.
- Mount under "Reports" section in `SettingsPage.tsx`.

### Secrets needed (requested after code lands)
- `TEAMS_WEBHOOK_URL` — Teams Incoming Webhook (user creates in Teams channel → Connectors).
- `RESEND_API_KEY` — already may exist via connector; will check `fetch_secrets` first.

### Out of scope
- Auto pg_cron install (provided as copy-paste SQL in the UI, not executed — contains user-specific URL).
- Changing existing WO/Reliability business logic.

## Technical notes
- Edge functions use `npm:@supabase/supabase-js@2/cors` for CORS, `npm:zod` for validation.
- Teams Adaptive Card schema 1.4, posted as `{ type: "message", attachments: [...] }`.
- Heatmap built with a simple CSS grid (no new chart lib) keyed off `filteredWOs`.
- All new UI text in English; uses existing design tokens (no hardcoded colors).

Approve to start building.