-- The leader the tablet wrote down but never linked.
--
-- A shift leader lives in two columns on production_sessions: `leader_id`, a link to
-- line_leaders, and `leader_name`, free text. The floor tablet only ever wrote the
-- name — the operator types who they are and hits sync — while the Intouch import
-- writes both. Measured on 27/08/2026:
--
--   production_sessions                          563 rows
--     leader_id set                               81   (14%)
--     leader_name only, no link                  344   (61%)   <- this migration
--     neither                                    139   (25%)   <- genuinely nobody
--
-- WHAT IT COST. Production Control asked "does this session have a leader?" in three
-- places by looking at the link, and answered the same question in the row itself by
-- looking at the name. The same session read "Gill" in the leader column and
-- "NO LEADER" on the bay plate two centimetres above it, and the amber no-leader
-- andon was lit on 482 of 563 rows. A warning that is always on is not a warning.
-- The reading was fixed in code (src/lib/sessionLeader.ts) and the tablet now
-- resolves the name as it saves, so this backfill closes the set rather than opening
-- a habit.
--
-- It also cost the leader as an entity: the weekly scorecards and the per-line
-- assignment join on `leader_id`, so 61% of the shifts that had a leader were absent
-- from every one of those numbers.
--
-- WHAT THIS DOES. Links the 344 by name, case-insensitively and with runs of
-- whitespace collapsed — the same key `resolveLeader` uses in the app, so the two
-- cannot drift into disagreeing. All 28 distinct names resolve to exactly one row of
-- line_leaders; the count below is 344 of 344, with none ambiguous, and was measured
-- before this was written.
--
-- WHAT IT REFUSES TO DO. A name matching two leaders is left exactly as it is:
-- picking one at random would put half of one person's shifts on the other's account
-- and nobody would ever notice, which is the worst way for a number to be wrong.
-- There are none today; the guard is here so there are none tomorrow either. And
-- sessions with no name at all are not touched — those 139 really did run without a
-- leader recorded, and the andon should still light for them.
--
-- Idempotent: it only ever considers rows where leader_id is null.
--
-- UNDOING IT. The rows it is about to change are copied into a table first, so the
-- undo is exact rather than a guess. It has to be exact: once leader_id is filled,
-- "leader_id is null and leader_name is not null" no longer finds these rows, and
-- there would be nothing left to tell them apart from the 81 that were already
-- linked. To put them back:
--
--   update production_sessions s
--      set leader_id   = b.leader_id_before,
--          leader_name = b.leader_name_before
--     from backfill_20260906_leader_id b
--    where s.id = b.session_id;

begin;

create table if not exists backfill_20260906_leader_id (
  session_id         uuid primary key references production_sessions(id) on delete cascade,
  leader_id_before   uuid,
  leader_name_before text,
  backfilled_at      timestamptz not null default now()
);

-- Nobody reads this table from the app; it exists for a person with the SQL editor
-- on the day something looks wrong. Locked down so it cannot become a side door.
alter table backfill_20260906_leader_id enable row level security;

insert into backfill_20260906_leader_id (session_id, leader_id_before, leader_name_before)
select s.id, s.leader_id, s.leader_name
  from production_sessions s
 where s.leader_id is null
   and s.leader_name is not null
on conflict (session_id) do nothing;

with matched as (
  select
    s.id                as session_id,
    count(l.id)         as hits,
    -- array_agg and not min(): Postgres has no min(uuid). With hits = 1 enforced
    -- below there is exactly one row to take, so which one is not a question.
    (array_agg(l.id))[1]   as leader_id,
    (array_agg(l.name))[1] as leader_name
  from production_sessions s
  join line_leaders l
    on lower(regexp_replace(btrim(l.name),        '\s+', ' ', 'g'))
     = lower(regexp_replace(btrim(s.leader_name), '\s+', ' ', 'g'))
  where s.leader_id is null
    and s.leader_name is not null
  group by s.id
)
update production_sessions s
   set leader_id   = m.leader_id,
       -- The roster's spelling wins, so one person is one name everywhere.
       leader_name = m.leader_name
  from matched m
 where s.id = m.session_id
   and m.hits = 1;

commit;
