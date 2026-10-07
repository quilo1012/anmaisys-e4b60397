-- A rule the floor can read.
--
-- The supervisor sees "2 sick · 1 absent" beside a name and decides. That is the right
-- default, and it stays the default. But two things the floor argues about should not
-- depend on who the supervisor is that week: whether a no-show keeps you out of the
-- next asks, and whether cancelling the night before is the same as cancelling with
-- a week's notice. Written down, they are a rule; left to judgement, they are a grudge.
--
-- One row of settings, both rules OFF until a manager turns them on:
--   no_show_block_days   0 = off. A no-show (and, if the switch says so, a late
--                        cancellation) blocks self-sign-up for this many days after the
--                        shift. The manager can still add the person at the desk.
--   late_cancel_hours    0 = off. "Cancelled" recorded fewer than this many hours before
--                        the shift starts is cancelled_late; otherwise cancelled_in_time.
--                        The manager records "cancelled"; the clock decides which.
--   late_cancel_blocks   whether cancelled_late counts toward the block above.
--
-- Idempotent.

create table if not exists public.overtime_rules (
  id                  boolean primary key default true check (id),
  no_show_block_days  integer not null default 0 check (no_show_block_days between 0 and 365),
  late_cancel_hours   integer not null default 0 check (late_cancel_hours between 0 and 168),
  late_cancel_blocks  boolean not null default false,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id)
);
insert into public.overtime_rules (id) values (true) on conflict (id) do nothing;

alter table public.overtime_rules enable row level security;
drop policy if exists "overtime_rules_read"   on public.overtime_rules;
drop policy if exists "overtime_rules_manage" on public.overtime_rules;
create policy "overtime_rules_read" on public.overtime_rules
  for select to authenticated using (true);
create policy "overtime_rules_manage" on public.overtime_rules
  for update to authenticated
  using (public.can_manage_overtime(auth.uid()))
  with check (public.can_manage_overtime(auth.uid()));

-- ---------------------------------------------------------------------------
-- Until when is this person out, and why. Null when they are not.
-- ---------------------------------------------------------------------------
create or replace function public.overtime_block_for(p_employee_id uuid)
returns table (blocked_until date, reason text, on_date date)
language sql stable security definer set search_path = public
as $$
  with rules as (select * from public.overtime_rules where id),
  hits as (
    select q.on_date,
           o.outcome,
           (q.on_date + r.no_show_block_days)::date as until_date
      from public.overtime_outcomes o
      join public.overtime_responses rs on rs.id = o.response_id
      join public.overtime_requests q on q.id = rs.request_id
      cross join rules r
     where rs.employee_id = p_employee_id
       and r.no_show_block_days > 0
       and (o.outcome = 'no_show' or (r.late_cancel_blocks and o.outcome = 'cancelled_late'))
       and (q.on_date + r.no_show_block_days) > current_date
  )
  select until_date, outcome, on_date
    from hits
   order by until_date desc
   limit 1;
$$;
grant execute on function public.overtime_block_for(uuid) to authenticated;

-- The caller's own block, for the My Overtime screen.
create or replace function public.my_overtime_block()
returns table (blocked_until date, reason text, on_date date)
language sql stable security definer set search_path = public
as $$
  select * from public.overtime_block_for(public.my_employee_id());
$$;
grant execute on function public.my_overtime_block() to authenticated;

-- ---------------------------------------------------------------------------
-- answer_overtime refuses a blocked person, and says until when.
-- ---------------------------------------------------------------------------
create or replace function public.answer_overtime(p_request_id uuid, p_answer text)
returns public.overtime_responses
language plpgsql security definer set search_path = public
as $$
declare
  v_emp   uuid := public.my_employee_id();
  v_row   public.overtime_responses;
  v_block record;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if p_answer not in ('yes', 'no') then
    raise exception 'Answer must be yes or no' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.overtime_requests where id = p_request_id and status = 'open') then
    raise exception 'This overtime is no longer open' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.overtime_responses
              where request_id = p_request_id and employee_id = v_emp and decision is not null) then
    raise exception 'The supervisor has already decided on your answer' using errcode = 'P0001';
  end if;
  -- A "no" is always allowed: it is information, not a request.
  if p_answer = 'yes' then
    select * into v_block from public.overtime_block_for(v_emp);
    if v_block.blocked_until is not null then
      raise exception 'You can''t sign up for overtime until %. (Missed overtime on %.)',
        to_char(v_block.blocked_until, 'DD/MM'), to_char(v_block.on_date, 'DD/MM')
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.overtime_responses (request_id, employee_id, answer)
  values (p_request_id, v_emp, p_answer)
  on conflict (request_id, employee_id)
  do update set answer = excluded.answer, answered_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_overtime_outcome accepts "cancelled" and lets the clock decide.
-- ---------------------------------------------------------------------------
create or replace function public.record_overtime_outcome(
  p_response_id uuid,
  p_outcome     text,
  p_note        text default null
)
returns table (promoted_response_id uuid, promoted_employee_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_req     public.overtime_requests;
  v_resp    public.overtime_responses;
  v_next    public.overtime_responses;
  v_outcome text := p_outcome;
  v_hours   integer := (select late_cancel_hours from public.overtime_rules where id);
  v_starts  timestamptz;
begin
  if not public.can_manage_overtime(auth.uid()) then
    raise exception 'Only somebody who manages overtime can record an outcome' using errcode = '42501';
  end if;
  if v_outcome not in ('attended', 'no_show', 'called_sick', 'cancelled', 'cancelled_in_time', 'cancelled_late') then
    raise exception 'Unknown outcome %', v_outcome using errcode = 'P0001';
  end if;

  select * into v_resp from public.overtime_responses where id = p_response_id for update;
  if v_resp.id is null then
    raise exception 'No such response' using errcode = 'P0001';
  end if;
  select * into v_req from public.overtime_requests where id = v_resp.request_id for update;

  -- "cancelled": in time or late, by the rule. With the rule off, in time.
  if v_outcome = 'cancelled' then
    v_starts := (v_req.on_date + v_req.starts_at)::timestamptz;
    v_outcome := case when v_hours > 0 and now() > v_starts - make_interval(hours => v_hours)
                      then 'cancelled_late' else 'cancelled_in_time' end;
  end if;

  insert into public.overtime_outcomes (response_id, outcome, note, recorded_by, recorded_at)
  values (p_response_id, v_outcome, p_note, auth.uid(), now())
  on conflict (response_id) do update
    set outcome = excluded.outcome, note = excluded.note,
        recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at;

  if v_resp.decision = 'accepted'
     and v_outcome <> 'attended'
     and v_req.status = 'open'
  then
    select * into v_next
      from public.overtime_responses r
     where r.request_id = v_req.id
       and r.decision = 'reserve'
       and r.answer = 'yes'
       and not exists (select 1 from public.overtime_outcomes o where o.response_id = r.id)
     order by r.answered_at
     limit 1
     for update skip locked;

    if v_next.id is not null then
      update public.overtime_responses
         set decision = 'accepted', decided_at = now(), decided_by = auth.uid()
       where id = v_next.id;
      return query select v_next.id, v_next.employee_id;
      return;
    end if;
  end if;

  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- The manager's list shows the block beside the name.
-- ---------------------------------------------------------------------------
drop function if exists public.overtime_reliability(date);
create function public.overtime_reliability(p_month date default current_date)
returns table (
  employee_id        uuid,
  sick_this_month    integer,
  absent_this_month  integer,
  ot_accepted_60d    integer,
  ot_attended_60d    integer,
  blocked_until      date
)
language sql stable security definer set search_path = public
as $$
  with bounds as (
    select date_trunc('month', p_month)::date                       as m_from,
           (date_trunc('month', p_month) + interval '1 month')::date as m_to,
           (current_date - 60)                                        as d60
  ),
  board as (
    select a.employee_id,
           count(*) filter (where a.status = 'sick')                       as sick,
           count(*) filter (where a.status in ('unpaid', 'absent', 'awol')) as absent
      from public.employee_attendance a, bounds b
     where a.on_date >= b.m_from and a.on_date < b.m_to
     group by a.employee_id
  ),
  clocks as (
    select d.employee_id,
           count(*) filter (where d.absence_name ~* 'sick')                                 as sick,
           count(*) filter (where d.absence_name is not null
                              and d.absence_name !~* 'sick'
                              and d.absence_name !~* 'holiday|vacation|annual')               as absent
      from public.attendance_days d, bounds b
     where d.on_date >= b.m_from and d.on_date < b.m_to
     group by d.employee_id
  ),
  ot_month as (
    select r.employee_id,
           count(*) filter (where o.outcome = 'called_sick')                          as sick,
           count(*) filter (where o.outcome in ('no_show', 'cancelled_late'))          as absent
      from public.overtime_outcomes o
      join public.overtime_responses r on r.id = o.response_id
      join public.overtime_requests q on q.id = r.request_id, bounds b
     where q.on_date >= b.m_from and q.on_date < b.m_to
     group by r.employee_id
  ),
  ot_60 as (
    select r.employee_id,
           count(*)                                            as accepted,
           count(*) filter (where o.outcome = 'attended')      as attended
      from public.overtime_responses r
      join public.overtime_requests q on q.id = r.request_id
      left join public.overtime_outcomes o on o.response_id = r.id, bounds b
     where r.decision = 'accepted' and q.on_date >= b.d60 and q.on_date <= current_date
     group by r.employee_id
  ),
  ids as (
    select employee_id from board
    union select employee_id from clocks
    union select employee_id from ot_month
    union select employee_id from ot_60
  )
  select i.employee_id,
         coalesce(b.sick, 0) + coalesce(c.sick, 0) + coalesce(m.sick, 0),
         coalesce(b.absent, 0) + coalesce(c.absent, 0) + coalesce(m.absent, 0),
         coalesce(s.accepted, 0),
         coalesce(s.attended, 0),
         (select blocked_until from public.overtime_block_for(i.employee_id))
    from ids i
    left join board    b on b.employee_id = i.employee_id
    left join clocks   c on c.employee_id = i.employee_id
    left join ot_month m on m.employee_id = i.employee_id
    left join ot_60    s on s.employee_id = i.employee_id;
$$;
grant execute on function public.overtime_reliability(date) to authenticated;
