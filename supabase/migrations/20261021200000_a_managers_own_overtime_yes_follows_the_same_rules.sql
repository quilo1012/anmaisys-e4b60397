-- ================================================================
-- BLOCO 117
-- 20261021200000_a_managers_own_overtime_yes_follows_the_same_rules.sql
-- ================================================================
--
-- PT: Quem tem permissao de gerir overtime (admin, supervisor...) e tambem e employee
-- conseguia dizer "yes" a dois overtimes do MESMO dia (ex. 06:00-18:00 e 06:00-14:00): o
-- guarda de horario (BLOCO 95/112) saltava a verificacao para qualquer gestor, mesmo quando
-- o yes era dele proprio. Passa a saltar so quando o gestor escreve o yes de OUTRA pessoa
-- (o supervisor a registar no balcao). O yes do proprio segue as mesmas regras de todos:
-- horas ja suas, descanso minimo, uma opcao por horario.
--
-- EN: Someone who can manage overtime (admin, supervisor...) and is also an employee could
-- say yes to two overtimes on the SAME day (e.g. 06:00-18:00 and 06:00-14:00): the schedule
-- guard skipped the check for any manager, even for their own yes. It now skips only when
-- the manager writes somebody ELSE's yes (the supervisor booking at the desk). Their own yes
-- follows the same rules as everyone's: hours already theirs, minimum rest, one option per slot.
--
-- PT: Alem disso, "ja e seu" passa a contar tambem o yes que ficou na reserva ou ainda sem
-- decisao, nao so o ja aceite: com a lista cheia o primeiro yes ia para a reserva e o segundo
-- passava. EN: Also, "already yours" now counts a yes on the reserve list or still undecided,
-- not only an accepted one: with the list full the first yes went to reserve and the second passed.

-- ── 1. One option per slot: a reserve or undecided yes counts too ───────────
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
  v_rest     integer := coalesce((select r.min_rest_hours from public.overtime_rules r where r.id), 0);
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
       and (r.decision in ('accepted', 'reserve')
            or (r.decision is null and r.answer = 'yes'))
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
    if public.overtime_rest_short(v_from, v_to, v_ot_from, v_ot_to, v_rest) then
      return format('Already down for overtime on %s, %s–%s',
        to_char(o.on_date, 'Dy DD/MM'), to_char(o.starts_at, 'HH24:MI'), to_char(o.ends_at, 'HH24:MI')) ||
        format(' (not enough rest: at most %s h of work in any 24 h)', 24 - v_rest);
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
      if public.overtime_rest_short(v_from, v_to, v_ot_from, v_ot_to, v_rest) then
        return format('%s on the %s shift on %s, %s–%s',
          case when b.status = 'overtime' then 'Already down for overtime' else 'Rostered' end,
          lower(b.shift), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI')) ||
          format(' (not enough rest: at most %s h of work in any 24 h)', 24 - v_rest);
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
      if public.overtime_rest_short(v_from, v_to, v_ot_from, v_ot_to, v_rest) then
        return format('Your rota has you on the %s shift on %s, %s–%s',
          lower(v_board), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI')) ||
          format(' (not enough rest: at most %s h of work in any 24 h)', 24 - v_rest);
      end if;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.overtime_schedule_clash(uuid, uuid) from public, anon, authenticated;

-- ── 2. The manager's own yes is checked ─────────────────────────────────────
create or replace function public.overtime_response_schedule_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_clash text;
  v_owner uuid;
begin
  if new.answer is distinct from 'yes' or new.decision is not null then return new; end if;
  if tg_op = 'UPDATE' and old.answer = 'yes' then return new; end if;
  if auth.uid() is null then return new; end if;

  select e.user_id into v_owner from public.employees e where e.id = new.employee_id;
  if public.can_manage_overtime(auth.uid()) and v_owner is distinct from auth.uid() then
    return new;
  end if;

  v_clash := public.overtime_schedule_clash(new.employee_id, new.request_id);
  if v_clash is not null then
    if v_clash like '%(not enough rest:%' then
      raise exception 'Not enough rest between your shifts: %', v_clash using errcode = 'P0001';
    end if;
    raise exception 'These hours are already yours: %', v_clash using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.overtime_response_schedule_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
