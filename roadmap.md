# Roadmap

- [x] Add Pattern Matrix WhatsApp preview, line/category selection and copy; 28 tests passed and authenticated Yesterday report copied exactly without changing records.

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
