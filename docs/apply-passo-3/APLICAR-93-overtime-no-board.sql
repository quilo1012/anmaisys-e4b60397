-- Accepted overtime is a plan on the board, not a day already worked.
--
-- Rosana Cardozo, 17/10/2026, 06:00–18:00: answered yes, a supervisor accepted, and the
-- Day board for the 17th had nothing for her. Read on 12/10/2026 in the SQL editor:
-- `overtime_responses.decision = 'accepted'`, no `daily_allocations` row on any shift,
-- and `pg_trigger` with no `overtime_response_to_board_t`. The bridge written in
-- 20261007120000 never reached production — the column `daily_allocations
-- .overtime_request_id` and `overtime_board_shift()` both answer 404 to the REST probe.
-- It was never a bug in the bridge; the wire was in the repository and not in the base.
--
-- This file is that bridge, whole and self-contained, so it can be pasted on its own,
-- with one change: it no longer writes `employee_attendance` 'present' at the moment
-- of acceptance. An ask is accepted days ahead. Writing 'present' for the 17th on the
-- 12th says she was in before the day exists, and My Attendance and the finance close
-- both read that table as a record. The board row (`status = 'overtime'`) is the plan;
-- presence comes from the clock (TimeMoto → attendance_days) or from a supervisor's
-- mark on the day, as for everybody else.
--
-- Everything 20261007120000 promised about what it will never touch still holds: it
-- only deletes rows carrying its ask's id, and it inserts with `on conflict do
-- nothing`, so a person already on the board that day keeps the row they have and is
-- never drawn twice.
--
-- The backfill at the end puts on the board every accepted answer, on an ask that is
-- not cancelled, for today or later. Past days are left alone: what happened on them
-- is the board's record already, and adding to it now would rewrite history.
--
-- Idempotent.

-- ── 1. The key the board rows carry home ───────────────────────────────────
alter table public.daily_allocations
  add column if not exists overtime_request_id uuid null
    references public.overtime_requests(id) on delete set null;

create index if not exists daily_allocations_overtime_request_id_idx
  on public.daily_allocations (overtime_request_id)
  where overtime_request_id is not null;

comment on column public.daily_allocations.overtime_request_id is
  'The overtime ask that put this row here, or null for every ordinary allocation. '
  'Only a row carrying an id may be removed by the overtime flow.';

-- ── 2. Which board an ask's hours belong to ────────────────────────────────
create or replace function public.overtime_board_shift(p_on_date date, p_starts_at time)
returns text
language sql stable set search_path = public
as $$
  select initcap(public.factory_shift_of((p_on_date + p_starts_at) at time zone 'Europe/London'));
$$;

-- ── 3. The one place that writes the board on behalf of an ask ─────────────
create or replace function public.overtime_board_apply(
  p_request_id  uuid,
  p_employee_id uuid,
  p_accepted    boolean
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_shift text;
begin
  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null then return; end if;

  if not p_accepted then
    -- Only ours. A row the planner made for the same person on the same day has no
    -- id on it and is invisible to this.
    delete from public.daily_allocations
     where overtime_request_id = p_request_id
       and employee_id = p_employee_id;
    return;
  end if;

  if v_req.status = 'cancelled' then return; end if;

  v_shift := public.overtime_board_shift(v_req.on_date, v_req.starts_at);

  -- Planned, not present: no employee_attendance here (see the header).
  insert into public.daily_allocations
    (on_date, shift, employee_id, status, area_id, is_leader, overtime_request_id)
  values
    (v_req.on_date, v_shift, p_employee_id, 'overtime', null, false, p_request_id)
  on conflict (on_date, shift, employee_id) do nothing;
end;
$$;

revoke all on function public.overtime_board_apply(uuid, uuid, boolean) from public, anon, authenticated;

-- ── 4. The decision ────────────────────────────────────────────────────────
create or replace function public.overtime_response_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- coalesce: `decision` is null until somebody decides, and null is not false.
  perform public.overtime_board_apply(
    new.request_id, new.employee_id, coalesce(new.decision = 'accepted', false));
  return new;
end;
$$;

drop trigger if exists overtime_response_to_board_t on public.overtime_responses;
create trigger overtime_response_to_board_t
  after insert or update of decision on public.overtime_responses
  for each row execute function public.overtime_response_to_board();

-- ── 5. The cancellation ────────────────────────────────────────────────────
create or replace function public.overtime_request_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    delete from public.daily_allocations where overtime_request_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_request_to_board_t on public.overtime_requests;
create trigger overtime_request_to_board_t
  after update of status on public.overtime_requests
  for each row execute function public.overtime_request_to_board();

-- ── 6. What was accepted before the wire existed ───────────────────────────
-- On 12/10/2026 this is one row: Rosana Cardozo, 17/10, Day.
select public.overtime_board_apply(r.request_id, r.employee_id, true)
  from public.overtime_responses r
  join public.overtime_requests q on q.id = r.request_id
 where r.decision = 'accepted'
   and q.status <> 'cancelled'
   and q.on_date >= current_date;
