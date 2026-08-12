-- What each machine is RUNNING, which this system never stored.
--
-- 12/08, 11:04Z: Line 2 sat in Line Preparation with zero production_items — the
-- 1.832 that had been on it were Line 3's production logged on the wrong line and
-- were deleted. The board could not name the product it was being set up for,
-- while the iTouching screen next to it could. Three places could have held the
-- answer and none did: `production_orders` has been empty since it was created,
-- `intouch_machine_map` had no product column at all, and `rag_weekly_entries`
-- carries a plan quantity with no SKU beside it.
--
-- So the poll records it. Not an order: no quantity is measured against these
-- columns and nothing is scored from them. They answer "what is on the line" for
-- a line nobody has written down yet, and the card marks the difference.
--
-- `job_checked_at` is separate from `job_seen_at` on purpose. One is when we last
-- ASKED iTouching, which is what throttles the extra egress; the other is when we
-- last got an answer. Without both, "no job running" and "we have not looked"
-- read identically, and the poll would ask ten machines every single minute.

alter table public.intouch_machine_map
  add column if not exists live_job_code text,
  add column if not exists live_job_name text,
  add column if not exists live_job_qty numeric,
  add column if not exists live_job_state text,
  add column if not exists live_job_seen_at timestamptz,
  add column if not exists live_job_checked_at timestamptz;

comment on column public.intouch_machine_map.live_job_code is
  'PartCode of the iTouching work order reported as Running. NULL when no job is running. Not an order in this system.';
comment on column public.intouch_machine_map.live_job_state is
  'running when iTouching reports the job as running, next when it is the head of the queue on a line still being set up. The board must not call the second one running.';
comment on column public.intouch_machine_map.live_job_seen_at is
  'When the poll last SAW a running job. Stale values are refused by the board.';
comment on column public.intouch_machine_map.live_job_checked_at is
  'When the poll last ASKED, answer or not. Throttles the extra iTouching egress.';

-- The view the screens read, because `intouch_machine_map` is readable by four
-- roles and the performance board by seven.
create or replace view public.v_line_live_status as
  select distinct on (l.name)
    l.name as line,
    m.intouch_machine_name as machine,
    m.last_status as status,
    case
      when m.last_downtime_code is null or btrim(m.last_downtime_code) = '' then null::text
      when cm.label is not null and btrim(cm.label) <> '' then cm.label
      else 'Unmapped stop code'
    end as reason,
    c.planned,
    m.last_seen_at as seen_at,
    case
      when m.last_downtime_code is null or btrim(m.last_downtime_code) = '' then null::timestamptz
      else coalesce(m.stop_since_at, m.prod_dt_started_at)
    end as stop_since,
    m.live_job_code as job_code,
    m.live_job_name as job_name,
    m.live_job_qty as job_qty,
    m.live_job_seen_at as job_seen_at,
    -- Appended last on purpose: `create or replace view` can only ADD columns at
    -- the end, and dropping the view to reorder them would drop its grants with
    -- it — the seven roles that read this board would lose it silently.
    m.live_job_state as job_state
  from public.intouch_machine_map m
  join public.lines l on l.id = m.line_id
  left join public.intouch_stop_code_map cm
    on lower(btrim(cm.stop_code)) = lower(btrim(m.last_downtime_code))
  left join public.intouch_stop_code_catalog c
    on lower(btrim(c.name)) = lower(btrim(cm.label))
  where m.active
  order by l.name, (m.last_downtime_code is not null) desc, m.last_seen_at desc nulls last;
