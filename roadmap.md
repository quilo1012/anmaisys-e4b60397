# Roadmap

## Telemetry errors (29 Oct)
- [ ] Recheck 20:58 audit error across all client queries and extend column regression; validate missing-tab presence guard and genuine-session tab generation, without database changes or publishing.
- [x] Check every audit_logs query against the nine existing columns; useAuditLogs.ts already uses entity_type and no current source references table_name. Added auditLogsColumns.test.ts; signed-in Audit Logs loads records with HTTP 206 and no invalid-column query.
- [x] Guard both presence lease writes in authenticatedRpc.ts using the pinned token's session_id; updated authenticatedRpc.test.ts, PresenceHeartbeat.test.tsx and aPresencaNaoBateSemTokenViva.test.tsx. All 24 focused tests pass; signed-in manager/audit navigation sends zero presence lease requests and logs zero presence warnings with the minted token; build OK. No database changes or publishing.

## Operator and engineer display labels
- [x] Trace TEC to Headcount chips and area/absence pickers; apply shared OP/ENG display mapping only; 39 regressions pass, signed-in preview shows 3 OP and 5 ENG badges with no TEC; no database changes or publishing.

## Production permission and SKU errors (27 Oct)
- [x] Verify deployed database identity: deployed scripts and live tool binding match; inspected function definitions, ACLs, owners, RLS and SKU dependencies.
- [x] Apply minimal directory/security and SKU identity/history safeguards in migration 0006; add pinned-token RPC calls, clear delete error and Active control.
- [x] Run 39 regressions; administrator manager/directory and same-value SKU edit pass; protected SKU delete rejected; anonymous functions reject access.
- [ ] Verify genuine login presence and operator scenarios — managed test tokens lack session_id; operator account question skipped. Frontend production deployment/PR not confirmed; no publish performed.

## Communication presence (uploaded brief 20/10)
- [ ] Prepare isolated implementation and pull request to `main` for review (20/10 clarification); no production deployment before review. PR creation tool unavailable in this session; production inspection needs the project-approved read-only query tool, and live verification needs two explicitly authorized accounts.
- [x] Inspect existing Hub, auth and leave sources; approved precedence and session expiry rules recorded. Production policy inspection blocked: required `query_database` tool unavailable; do not use unrelated databases.
- [x] Prepare pure availability/lease/calendar rules: 19 tests passed, alongside 29 existing leave tests; automatic build OK. No live feature until production verification and reviewed deployment are available.
- [ ] Implement secure own-availability persistence and authorized live presence without changing messages or employee records — blocked by required production inspection access and `main` pull-request deployment workflow.
- [ ] Integrate accessible status selection and indicators throughout the existing Hub — blocked by the authorized presence API, not a client-only simulated status.
- [ ] Verify separate real accounts, interruption/expiry/multiple sessions, leave privacy and desktop/mobile — blocked by live implementation and access to a second authorized account; existing admin Hub inspected without writes.

- [x] Verify and fix the global deadline cutting off slow imports/reports; 9 timeout tests passed and a controlled 16-second request completed in the authenticated app.
- [x] Verify and isolate active-leader query cache shapes; 2 cache tests passed and Quality's leader list showed 32 choices after navigating from Performance without reloading.

- [x] Fix Maikon's 21 Oct Night overtime overlapping his rota; Day retained, Night declined, SQL rollback regressions and 29 tests passed; live Night board shows Office suggestion and zero overtime.

- [x] Fill unplaced Headcount employees from habitual positions or each person's previous worked day; 65 tests and matrix browser check passed; authenticated 21 Oct Day shows 95 suggestions without saving production rows.

- [x] Fix audit activation action mismatch; deploy log-audit-event; 20 regression tests passed. Verify overtime snapshot columns already exist in production (21 responses); no schema/data changes needed
- [x] Draw Lab, Blender Room and Office in the Production band of the Headcount board; 93 sheet/block tests passed, live board shows all three under Production with totals unchanged

- [ ] Verify both reported flows signed in — blocked by unavailable authenticated browser session; no live activation or audit test rows created

- [x] Allow managers to open/correct employee records and view rota, position and shift history without Headcount; verify Weekend option

- [x] Fix 2 failing tests after qualityImport corrections
- [x] Report: removed shift time range, added "- No issues today." fallback
- [x] Remove destination from the production logging UI without changing stored history
- [x] Show the current line team automatically during the first 15 minutes of each shift
- [x] Employee panel: Yuri Correa missing option + shift Night vs Tue–Fri days rota

## Employee Management System improvements (uploaded doc 19/10) — staged, all items approved
- [x] Stage 1 — Overtime: (A) quantity optional when opening an ask, (B) employee can cancel a confirmed booking, (C) Day vs Night overtime colours
- [ ] Stage 2 — Communication Centre: messages off Overview, dedicated centre, team/all announcements, Teams-like notifications
- [ ] Stage 3 — Meeting scheduling: schedule/update/cancel with notifications and reminders
- [ ] Stage 4 — Attendance notifications: late arrivals, missing clock-in/out alerts, employee attendance summaries
- [ ] Stage 5 — Notification management: centralised categories, read/unread, history
- [ ] Stage 6 — UI/UX polish: consistent professional look, clean Overview, desktop+mobile
