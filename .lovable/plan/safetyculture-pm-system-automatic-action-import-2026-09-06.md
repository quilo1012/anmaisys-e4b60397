# SafetyCulture → PM System: automatic Action import

## 1. What already exists (and will be reused)

- **Database / backend**: Lovable Cloud (Postgres + Auth + Edge Functions). `pg_cron` and `pg_net` are already installed, so scheduled syncing needs no external scheduler.
- **Records table**: `public.quality_actions` — already holds line, description, leader_id + leader_name, labels, department, severity, shift, recorded_at, validation_status, closed_at, attachments, domain. This is the "Record" the imported Actions will become. No parallel table.
- **Lines**: `public.lines` (name, active).
- **Leaders**: `public.line_leaders` (name, line, shift, active) and `public.leader_line_assignment` (leader_id, line_id, valid_from/valid_to). Leader resolution reads these — nothing hard-coded.
- **Classification vocabulary**: `public.quality_options` (kinds: `label`, `department`, `safety_label`, …) and `public.quality_action_types`. Already editable from the app.
- **Admin/settings**: `SettingsPage` card grid, `system_settings` for non-secret config, role/action gating via `has_action` / `can()`.
- **Secrets**: edge functions read secrets from the environment; nothing reaches the browser.

## 2. New database objects (minimum needed)

Added to `quality_actions` (nullable, so nothing existing breaks):
`source` (default `'pm'`), `external_id`, `external_url`, `external_status`, `external_priority`, `assignee_name`, `due_date`, `needs_classification`, `last_synced_at`, `external_updated_at`.
Unique index on `(source, external_id)` — the idempotency key.

New tables:
- `sc_classification_rules` — configurable mapping: match on a SafetyCulture field (label/template/title/custom field) → department, label, severity. Editable in the app, no code change.
- `sc_sync_state` — single row: last cursor/timestamp, last attempt, last success, counters (imported / updated / skipped / errors).
- `sc_sync_logs` — one row per event: received, created, updated, skipped-duplicate, auth error, API error, classification error, line/leader error. Includes the Action id and message, never the token.

All with GRANTs and RLS: read for admin/manager/quality roles, writes only from the edge function (service role).

## 3. Server functions

- `safetyculture-sync` — the worker. Modes: `test` (auth check only, returns org name/status), `sync` (incremental pull), `full` (window override). Uses the SafetyCulture Actions API with `SAFETYCULTURE_API_TOKEN` and `SAFETYCULTURE_ORGANIZATION_ID`, paginated, incremental by `modified_after` cursor stored in `sc_sync_state`. Handles timeout (abort + retry with backoff), 429 rate limit (respects `Retry-After`), 401 (logged as auth error, sync stops), and deleted/archived Actions (marked, not deleted).
- `safetyculture-webhook` — accepts SafetyCulture event pushes, verified with a shared secret header, and runs the same upsert path. Webhook is preferred; the cron poll stays on as the safety net so a missed event self-heals.
- A `pg_cron` job calling the sync every 10 minutes.

Both functions validate the caller (JWT + role for manual runs; shared secret for the webhook), matching the project's existing edge-function rules.

## 4. Flow

```text
SafetyCulture Action created/updated
        │  webhook event  (or cron poll every 10 min, incremental cursor)
        ▼
safetyculture-sync  ── auth, fetch, paginate ──► normalize
        ▼
 line resolved from Action fields → lines table
 leader resolved from leader_line_assignment / line_leaders (by line + date)
 classification from sc_classification_rules (structured fields first, title last)
        ▼
 upsert quality_actions ON CONFLICT (source, external_id)
   • new  → insert, source='safetyculture'
   • seen → update in place, never a second row
   • completed in SC → status/closed_at set on the PM record
   • unresolved line / leader / type → needs_classification = true, nothing invented
        ▼
 sc_sync_logs + sc_sync_state counters
```

Imported records land with `validation_status` unvalidated, so they do not move any leader score until Quality reviews them — the existing scoring rules stay exactly as they are.

## 5. Classification strategy

1. Structured fields on the Action (labels, template/asset, custom fields, site) matched against `sc_classification_rules`.
2. Seeded rules cover the initial vocabulary: LABELS (Missing spec, Wrong label, Missing label, Incorrect information, Damaged label, Other) and PAPERWORK (Missing paperwork, Wrong paperwork, Incomplete paperwork, Other).
3. Title matching only as the last resort, and only for rules explicitly marked as title rules.
4. No confident match → `needs_classification = true`, the record is still created (nothing is lost) and shows a "Needs classification" badge for manual correction.

## 6. Admin area

`Settings → Integrations → SafetyCulture` (new page, gated on the system-settings permission):
integration status, configured Organization ID, whether the token is present (never its value), last successful sync, last attempt, actions imported, error count, recent log entries, **Test connection** and **Sync now** buttons.

## 7. Security

Token lives only in edge-function secrets — never in the browser bundle, never in a response, never written to `sc_sync_logs`. I will request `SAFETYCULTURE_API_TOKEN` and `SAFETYCULTURE_ORGANIZATION_ID` from you through the secrets prompt; no real values go into the code.

## 8. Order of work

1. Migration (columns, three new tables, RLS/grants, seed rules).
2. Secrets prompt.
3. `safetyculture-sync` + `safetyculture-webhook` + cron job.
4. Unit tests for normalization, classification and line/leader resolution.
5. Admin page + Settings link + "Needs classification" surfacing on the Quality Actions screen.
