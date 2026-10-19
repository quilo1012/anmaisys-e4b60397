# Project Architecture Rules

- Build Headcount suggestions per employee from standing matrix positions then same-shift working history, and save through the existing copy safeguards; a partial board must not suppress suggestions or overwrite saved records.

- Overtime-generated allocations never suppress the employee's normal rota in clash checks; only a manual allocation on their regular board replaces that day's rota, so cross-shift overtime cannot hide rostered hours.

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
