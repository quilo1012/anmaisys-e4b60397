# Project Architecture Rules

- Derive workforce badge labels through `workforceRoles.roleStripe`, including existing role/source context when available; display distinctions must never alter identity or authorization.

- Protected engineer-directory and presence-write RPCs pin the live session token on the request; a concurrent session change must not silently send them as anon. Presence lease writes silently skip tokens without a session_id claim or calls without a nonempty tab id, because both are required for a server lease.
- SKU edits update attributes by the existing ID; server-side delete/ID guards protect all production dependencies, and retirement uses the existing active flag.

- Keep Communication availability preferences independent of connection leases and derive the final status through `communicationPresence`; server authorization and timestamps must be verified before wiring the Hub, so offline/reconnect cannot overwrite a preference or expose private leave/session records.

- Give reads, RPCs and edge functions a long request deadline while keeping direct table saves short, because cold-start imports and reports legitimately exceed interactive save times.
- Scope leader query keys by selected row shape beneath the active-leader family prefix, so caches cannot mix id/name and name/shift rows while shared invalidation still refreshes both.

- Build Headcount suggestions per employee from standing matrix positions then same-shift working history, and save through the existing copy safeguards; a partial board must not suppress suggestions or overwrite saved records.

- Overtime-generated allocations never suppress the employee's normal rota in clash checks; only a manual allocation on their regular board replaces that day's rota, so cross-shift overtime cannot hide rostered hours.
- Overtime the office places on the Headcount by hand (an `overtime` board row with no ask of theirs behind it) is a booking on My Overtime, read through `overtimeOnTheBoardOnly`; never write an answer to make it appear. On My Attendance, an `attended` overtime shift counts in the period's overtime only on a date the clock has no worked minutes for (`summariseOvertimeShifts.notOnClock`), so nothing is counted twice and the clock takes over once imported; the screen says how much came from each, and the office's finance close still reads the clock alone (owner's decision, 30/10/2026).

- Gate employee records with dedicated employee permissions, not workforce access, so corrections do not open Headcount or payroll.
- Record employee rota, job and shift changes server-side and display existing dated crew history alongside them, so edits from every writer remain traceable without inventing past job titles.

- Mount start-of-shift tablet acknowledgements inside `OperatorLineGuard`, because only authenticated operator line screens may display them.
- Pin the areas the factory reads as production to the Production band in `headcountBlocks`, not in the stored `section`, because direct SQL rewrites that column and the board must not change shape between mornings; `kind` still decides what the totals count.

## Which database you are looking at

Production is the Lovable Cloud database `ybtrzqzliepknpzqdajx`, reached **only** through
the Lovable MCP `query_database` with project_id `091e038b-48fc-421f-9245-b03e63c99308`.

The Supabase connector cannot see it. `list_projects` returns three other databases — a
migration target, a paused old copy, and an unused one — and none of them is production.
So **every Supabase advisor or security report is, by construction, about a database the
factory does not use.**

Before acting on any finding that came from a database:

1. Say which database it came from. If it did not come from `query_database` with that
   project_id, it is not about production.
2. Count the rows. An empty table leaks nothing, whatever its columns are called.
3. Only then decide.

This has gone wrong three times — 28/09, 02/10 and 03/10 — twice proposing urgent RLS
work against a paused copy with zero rows in it. Read `claude/mapa-de-sistemas.md` before
drawing a conclusion about data; it carries the current reference counts and what each
database is for.

## The board and the clock are two separate records

`daily_allocations` is the plan, written in the morning and often days ahead.
`attendance_days` is the record, written by the door by TimeMoto. **Neither corrects the
other.** Nothing syncs, repairs or overrides; screens show what each source holds,
disagreements included, and stop there. Decided 02/10 — see
`claude/melhorias-workforce-2026-10-02.md`.

## Database objects the app reads must exist in a migration

Applying a view or function straight to production through MCP, without writing the
migration, leaves the app working in production and broken on any fresh database. It has
happened twice. `src/__tests__/aAppNaoLeNadaQueNaoEstejaNumaMigracao.test.ts` now fails
when it recurs.

## A merge does not publish the server functions

A pull request that changes `supabase/functions/` reaches `main` and the Lovable project,
and the app is published from there. **The functions running in production are not.**
Found 29/10/2026: production `send-push` was still a build from before 21/10 19:19. It
refused the database's `x-cron-secret` with 401, so every chat message, overtime reminder
and confirmation the database tried to push since BLOCO 117 stopped at the last step. The
bell showed them all the while. Every change to `send-push` merged since then (21/10 and
26/10) was in the repository and nowhere else.

- `.github/workflows/deploy-functions.yml` points at production, but its only run (10/10)
  failed at the Deploy step. Do not count on it.
- Production functions are published by the Lovable agent, at the owner's request. It
  spends workspace credits, so ask first.
- A PR that touches `supabase/functions/` says in its description which functions need
  publishing. The work is not done until they are published and checked.
- A bell row is not a delivery. To see whether a push left, read
  `overtime_booking_notices.last_error`, or run
  `docs/apply-passo-3/VERIFY-send-push-publicado.sql`. Never judge by the bell.

## Production follows `main` — change the code here, not in the Lovable chat

The Lovable project serves what is on this repository's `main`. Verified 06/10/2026: the
project's `latest_commit_sha` and `main` were the same commit, `status: identical`.

So **code changes belong in a pull request to `main`**, which is also how they get review
and CI. Asking the Lovable chat agent to edit the code instead spends workspace credits,
skips both, and ends up in the same place anyway. On 06/10 the workspace ran out of
credits, so that route was not even available — while the GitHub one kept working.

**Secrets are the exception, and they are not in this repository.** `ANTHROPIC_API_KEY`,
`LOVABLE_API_KEY` and the rest exist only in the project's settings, and nothing here can
read or set them — ask the owner. Keeping them out is deliberate: on 15/09 a
`.env.production` holding a `live_` payments token was committed to this repository while
it was public. Do not "fix" a missing secret by putting it in a file.

- The employee panel's History and Overtime are built in `employeePanelHistory` from the board, the asks, the clock and payroll side by side; `useUpdateEmployee` writes a shift-history row only when the held shift or rota actually differs, so saves that change nothing leave no dated change.
- Decide "half day" on the Headcount board only through `isHalfDay` (`half_day` true or a "half day" sheet tag); a working half day is drawn on its line and mirrored in Holidays (board, print, export), counted once on the line, and drops/imports keep the marker instead of replacing the holiday.
- Read a board row's hours only through `placementHours` / `workedWindow` (`chipHours` for the chip, `sheetHoursOf` for print/export): `left_early_at` is "went home at" and `arrived_late_at` "came in at", compared signed against the booked hours (ask window or shift), so a time past the booked end is a stay-late, never an early finish; the ask itself stays as offered.
