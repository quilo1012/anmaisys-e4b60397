# Project Architecture Rules

- Mount start-of-shift tablet acknowledgements inside `OperatorLineGuard`, because only authenticated operator line screens may display them.

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
