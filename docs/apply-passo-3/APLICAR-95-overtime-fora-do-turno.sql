-- Overtime is not offered on hours the person is already rostered for.
--
-- A weekend-crew packer whose Saturday is 06:00–18:00 saw the Saturday 06:00–18:00
-- ask on their phone, with "Yes, I can" live. The screen narrowed asks by department
-- and crew label and nothing else; `answer_overtime` checked the same two labels. A
-- crew label says which board somebody is drawn on, not which days and hours they
-- work, so a person could say yes to overtime on top of their own shift — and the
-- board bridge, `on conflict do nothing`, would quietly keep the one row they had.
--
-- The question is asked of the date, not of the person: what is this employee
-- actually down to work on the day of the ask, and the days either side of it?
--
--   1. The board (`daily_allocations`), where it has been drawn for them that day.
--      `assigned` is their shift. `overtime` placed by hand (no ask id) is overtime
--      already given. A holiday, sickness, unpaid or training row says they are not
--      on their rota that day, and the rota is not consulted.
--   2. Otherwise the rota they held ON THAT DATE (`employee_shift_history`, falling
--      back to the employee row): the pattern's weekdays, or the Fri–Mon crews' own
--      days. No rota recorded is unknown, which is not working — the same rule the
--      board's roster uses — so nobody is hidden on a guess.
--   3. Overtime already accepted on another ask that was not cancelled and not
--      dropped out of.
--
-- Hours, not labels. The pattern's start and end for that weekday
-- (`shift_pattern_days` first, then the pattern), or else the factory's 06:00–18:00
-- day and 18:00–06:00 night. An ask clashes when its window overlaps one of these.
-- The day before and after are read too: Friday's night runs into Saturday morning,
-- and a night ask can run into Sunday's day shift. A Day person on a Night ask with no
-- overlap is not refused here; the cross-shift rules (rest, the supervisor's
-- choice) are where they always were.
--
-- What changes:
--   * `overtime_schedule_clash(employee, ask)` — the one rule. Returns why, or null.
--     Not callable from the client; the two functions below are.
--   * `my_overtime_clashes()` — the signed-in employee's open asks that clash, so the
--     phone stops offering them.
--   * `overtime_schedule_clashes(asks[])` — the same answer for the supervisor's
--     screen, for everybody active, behind `overtime.manage`.
--   * `answer_overtime` refuses a "yes" that clashes. A "no" is still always allowed.
--     Everything else in it is 20261012080000 unchanged.
--
-- No trigger on acceptance: the reserve that steps in when somebody drops out is
-- promoted inside `record_overtime_outcome`, and a raise there would lose the outcome
-- being recorded. The supervisor's screen refuses the accept instead, from the same
-- function.
--
-- Needs BLOCO 80 (answered_for_* on overtime_responses) and BLOCO 93
-- (daily_allocations.overtime_request_id). Stops with a message if either is missing.
--
-- Idempotent.

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'overtime_responses'
                    and column_name = 'answered_for_date') then
    raise exception 'Paste APLICAR-78-a-89.sql first: overtime_responses.answered_for_date is missing';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'daily_allocations'
                    and column_name = 'overtime_request_id') then
    raise exception 'Paste APLICAR-93-overtime-no-board.sql first: daily_allocations.overtime_request_id is missing';
  end if;
end;
$$;

-- ── 1. The rule ─────────────────────────────────────────────────────────────
create or replace function public.overtime_schedule_clash(p_employee_id uuid, p_request_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_req      public.overtime_requests;
  v_ot_from  timestamp;
  v_ot_to    timestamp;
  v_day      date;
  v_crew     text;
  v_pattern  uuid;
  v_days     smallint[];
  v_p_start  time;
  v_p_end    time;
  v_board    text;
  v_drawn    boolean;
  v_start    time;
  v_end      time;
  v_from     timestamp;
  v_to       timestamp;
  b          record;
  o          record;
begin
  if p_employee_id is null then return null; end if;
  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null then return null; end if;

  -- Local wall time throughout: the ask, the rota and the board are all written in it.
  v_ot_from := v_req.on_date + v_req.starts_at;
  v_ot_to   := v_req.on_date + v_req.ends_at;
  if v_req.ends_at <= v_req.starts_at then v_ot_to := v_ot_to + interval '1 day'; end if;

  -- Overtime already given on another ask.
  for o in
    select q.on_date, q.starts_at, q.ends_at
      from public.overtime_responses r
      join public.overtime_requests q on q.id = r.request_id
     where r.employee_id = p_employee_id
       and r.decision = 'accepted'
       and q.id <> v_req.id
       and q.status <> 'cancelled'
       and q.on_date between v_req.on_date - 1 and v_req.on_date + 1
       and not exists (
         select 1 from public.overtime_outcomes x
          where x.response_id = r.id
            and x.outcome in ('no_show', 'called_sick', 'cancelled', 'cancelled_in_time', 'cancelled_late'))
  loop
    v_from := o.on_date + o.starts_at;
    v_to   := o.on_date + o.ends_at;
    if o.ends_at <= o.starts_at then v_to := v_to + interval '1 day'; end if;
    if v_from < v_ot_to and v_ot_from < v_to then
      return format('Already down for overtime on %s, %s–%s',
        to_char(o.on_date, 'Dy DD/MM'), to_char(o.starts_at, 'HH24:MI'), to_char(o.ends_at, 'HH24:MI'));
    end if;
  end loop;

  -- The normal schedule, the day before through the day after.
  for v_day in
    select d::date from generate_series(v_req.on_date - 1, v_req.on_date + 1, interval '1 day') d
  loop
    -- The crew and rota held on that date, not today's.
    v_crew := null; v_pattern := null;
    select h.shift_group, h.shift_pattern_id into v_crew, v_pattern
      from public.employee_shift_history h
     where h.employee_id = p_employee_id and h.effective_from <= v_day
     order by h.effective_from desc
     limit 1;
    if not found then
      select e.shift_group, e.shift_pattern_id into v_crew, v_pattern
        from public.employees e where e.id = p_employee_id;
    end if;

    v_days := null; v_p_start := null; v_p_end := null;
    if v_pattern is not null then
      select p.days, coalesce(pd.starts_at, p.starts_at), coalesce(pd.ends_at, p.ends_at)
        into v_days, v_p_start, v_p_end
        from public.shift_patterns p
        left join public.shift_pattern_days pd
          on pd.pattern_id = p.id and pd.weekday = extract(isodow from v_day)
       where p.id = v_pattern;
    elsif v_crew in ('Weekend', 'Warehouse Weekend') then
      v_days := array[5, 6, 7, 1]::smallint[];
    end if;
    -- The board a crew is drawn on: Night, or Day for every other crew.
    v_board := case when v_crew is null then null when v_crew = 'Night' then 'Night' else 'Day' end;

    -- The board, where it has been drawn for this person on this day.
    v_drawn := false;
    for b in
      select a.shift, a.status, a.sheet_start_time, a.overtime_request_id
        from public.daily_allocations a
       where a.employee_id = p_employee_id and a.on_date = v_day
    loop
      v_drawn := true;
      -- Rows an ask wrote are the accepted answers above, read with their own hours.
      continue when b.overtime_request_id is not null;
      continue when b.status not in ('assigned', 'overtime');

      if b.shift = v_board and v_p_start is not null and v_p_end is not null then
        v_start := v_p_start; v_end := v_p_end;
      elsif b.shift = 'Night' then
        v_start := '18:00'; v_end := '06:00';
      else
        v_start := '06:00'; v_end := '18:00';
      end if;
      -- The sheet's own start, when it wrote one ("09:00").
      if b.sheet_start_time ~ '^\s*([01]?\d|2[0-3]):[0-5]\d\s*$' then
        v_start := trim(b.sheet_start_time)::time;
      end if;

      v_from := v_day + v_start;
      v_to   := v_day + v_end;
      if v_end <= v_start then v_to := v_to + interval '1 day'; end if;
      if v_from < v_ot_to and v_ot_from < v_to then
        return format('%s on the %s shift on %s, %s–%s',
          case when b.status = 'overtime' then 'Already down for overtime' else 'Rostered' end,
          lower(b.shift), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI'));
      end if;
    end loop;

    -- Not drawn yet: the rota says whether they are due.
    if not v_drawn and v_board is not null and v_days is not null
       and extract(isodow from v_day)::smallint = any (v_days) then
      v_start := coalesce(v_p_start, case v_board when 'Night' then '18:00'::time else '06:00'::time end);
      v_end   := coalesce(v_p_end,   case v_board when 'Night' then '06:00'::time else '18:00'::time end);
      v_from := v_day + v_start;
      v_to   := v_day + v_end;
      if v_end <= v_start then v_to := v_to + interval '1 day'; end if;
      if v_from < v_ot_to and v_ot_from < v_to then
        return format('Your rota has you on the %s shift on %s, %s–%s',
          lower(v_board), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI'));
      end if;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.overtime_schedule_clash(uuid, uuid) from public, anon, authenticated;

-- ── 2. The employee's phone ─────────────────────────────────────────────────
create or replace function public.my_overtime_clashes()
returns table (request_id uuid, reason text)
language sql stable security definer set search_path = public
as $$
  with me as (select public.my_employee_id() as id)
  select c.request_id, c.reason
    from (
      select q.id as request_id, public.overtime_schedule_clash(me.id, q.id) as reason
        from public.overtime_requests q, me
       where me.id is not null
         and q.status = 'open'
         and q.on_date >= current_date - 1
    ) c
   where c.reason is not null;
$$;

revoke all on function public.my_overtime_clashes() from public, anon;
grant execute on function public.my_overtime_clashes() to authenticated;

-- ── 3. The supervisor's screen ──────────────────────────────────────────────
create or replace function public.overtime_schedule_clashes(p_request_ids uuid[])
returns table (request_id uuid, employee_id uuid, reason text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_manage_overtime(auth.uid()) then
    raise exception 'Not allowed to manage overtime' using errcode = '42501';
  end if;
  if coalesce(array_length(p_request_ids, 1), 0) > 100 then
    raise exception 'Ask for at most 100 overtime asks at a time' using errcode = '22023';
  end if;

  return query
    select c.request_id, c.employee_id, c.reason
      from (
        select q.id as request_id, e.id as employee_id,
               public.overtime_schedule_clash(e.id, q.id) as reason
          from public.overtime_requests q
          cross join public.employees e
         where q.id = any (p_request_ids)
           and q.status <> 'cancelled'
           and (e.active
                or exists (select 1 from public.overtime_responses r
                            where r.request_id = q.id and r.employee_id = e.id))
      ) c
     where c.reason is not null;
end;
$$;

revoke all on function public.overtime_schedule_clashes(uuid[]) from public, anon;
grant execute on function public.overtime_schedule_clashes(uuid[]) to authenticated;

-- ── 4. The answer refuses a yes on top of the person's own hours ────────────
create or replace function public.answer_overtime(p_request_id uuid, p_answer text)
returns public.overtime_responses
language plpgsql security definer set search_path = public
as $$
declare
  v_emp     uuid := public.my_employee_id();
  v_req     public.overtime_requests;
  v_dept    text;
  v_shift   text;
  v_row     public.overtime_responses;
  v_block   record;
  v_clash   text;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if p_answer not in ('yes', 'no') then
    raise exception 'Answer must be yes or no' using errcode = 'P0001';
  end if;

  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null or v_req.status <> 'open' then
    raise exception 'This overtime is no longer open' using errcode = 'P0001';
  end if;

  -- Who the answerer is, as the ask measures them.
  select department, shift_group into v_dept, v_shift
    from public.employees where id = v_emp;

  if v_req.department is not null and v_req.department is distinct from v_dept then
    raise exception 'This overtime is for % and you are not in it', v_req.department
      using errcode = 'P0001';
  end if;
  if v_req.shift_group is not null and v_req.shift_group is distinct from v_shift then
    raise exception 'This overtime is for the % crew', v_req.shift_group
      using errcode = 'P0001';
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
    -- Overtime on top of your own shift is the same hours twice, not overtime.
    v_clash := public.overtime_schedule_clash(v_emp, p_request_id);
    if v_clash is not null then
      raise exception 'These hours are already yours: %', v_clash using errcode = 'P0001';
    end if;
  end if;

  insert into public.overtime_responses (
    request_id, employee_id, answer,
    answered_for_date, answered_for_starts_at, answered_for_ends_at)
  values (
    p_request_id, v_emp, p_answer,
    v_req.on_date, v_req.starts_at, v_req.ends_at)
  on conflict (request_id, employee_id)
  do update set answer    = excluded.answer,
                answered_at = now(),
                -- Mudar de ideias e responder ao turno de AGORA, por isso o
                -- instantaneo anda com a resposta e nao fica no primeiro valor.
                answered_for_date      = excluded.answered_for_date,
                answered_for_starts_at = excluded.answered_for_starts_at,
                answered_for_ends_at   = excluded.answered_for_ends_at
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.answer_overtime(uuid, text) from public, anon;
grant execute on function public.answer_overtime(uuid, text) to authenticated;
