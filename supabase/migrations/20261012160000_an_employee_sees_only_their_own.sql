-- An employee sees their own records, and nobody else's.
--
-- The `employee` login is the one a badge or the invite link hands out: the whole floor,
-- on their own phones. Four things let that login read past itself, and this closes all
-- four. Nothing here changes what admin, manager or the office admin can read.
--
-- 1. `has_action` honoured any Permissions-screen grant for any role. One tick of
--    `workforce.view` for the employee role would have opened `employees`, the leave
--    screens and the finance close to every badge login, in the database as well as
--    the menu. The employee role now has a CEILING: outside `overtime.respond` and
--    `attendance.view_own` a grant to it does nothing. Mirrors EMPLOYEE_CEILING in
--    src/lib/permissions.ts.
--
-- 2. `overtime_reliability()` is SECURITY DEFINER with no check on who asks. Any
--    signed-in login got every person's sick and absent count for the month — health
--    data, one row per employee. It now answers only to whoever runs overtime.
--
-- 3. `overtime_responses` and `overtime_outcomes` were readable by every signed-in login
--    (`using (true)`, decided 06/10: "the floor already knows who put their hand up").
--    Reversed on 12/10 at the owner's request: every yes, no, no-show and called-sick
--    reached every employee's device, and My Overtime only ever used the caller's own.
--    A person now reads their own rows; whoever runs overtime reads all of them.
--    Every function that reads these tables for somebody else is SECURITY DEFINER
--    (answer_overtime, record_overtime_outcome, overtime_block_for, the board bridge),
--    so none of them is narrowed by this.
--
-- 4. My Attendance needs the caller's own clock, marks, plan and leave, and those
--    tables are readable by staff only. Rather than a self-read policy on each of five
--    tables — five more doors, two of them on tables no migration in this repository
--    creates — one function returns the caller's own rows and nothing else. It
--    calculates nothing: the screen runs the same TypeScript the finance close runs
--    (`countDaysAway`, `buildClose`, `leaveBalance`), so the two cannot disagree.
--
-- Idempotent and independent of BLOCOS 88–89. Paste after BLOCO 89.

-- ---------------------------------------------------------------------------
-- 1. The employee ceiling, in the one function every matrix check goes through
-- ---------------------------------------------------------------------------
create or replace function public.has_action(
  _uid uuid,
  _action text,
  _baseline app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    left join public.role_permission_overrides o
      on o.role = ur.role and o.action = _action
    where ur.user_id = _uid
      and case
            when ur.role = 'admin'::app_role then true
            -- The ceiling comes before the override on purpose: a grant beyond it
            -- must do nothing, not merely be outvoted by the baseline.
            when ur.role = 'employee'::app_role
             and _action <> all (array['overtime.respond', 'attendance.view_own'])
              then false
            else coalesce(o.allowed, ur.role = any (_baseline))
          end
  );
$$;

revoke all on function public.has_action(uuid, text, app_role[]) from public;
grant execute on function public.has_action(uuid, text, app_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The reliability numbers answer only to whoever runs overtime
-- ---------------------------------------------------------------------------
-- The body is 20261006220000's, the current one (with `blocked_until`), unchanged but
-- for the last line. Same signature and columns, so `create or replace` keeps grants.
create or replace function public.overtime_reliability(p_month date default current_date)
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
    left join ot_60    s on s.employee_id = i.employee_id
   -- Everybody else gets no rows: the same answer as "nobody was off this month",
   -- which is what an empty column beside a name already means on the manager's panel.
   where public.can_manage_overtime(auth.uid());
$$;

revoke all on function public.overtime_reliability(date) from public;
grant execute on function public.overtime_reliability(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Answers and outcomes: your own, or all of them if you run overtime
-- ---------------------------------------------------------------------------
drop policy if exists "overtime_responses_read" on public.overtime_responses;
create policy "overtime_responses_read" on public.overtime_responses
  for select to authenticated
  using (employee_id = public.my_employee_id() or public.can_manage_overtime(auth.uid()));

drop policy if exists "overtime_outcomes_read" on public.overtime_outcomes;
create policy "overtime_outcomes_read" on public.overtime_outcomes
  for select to authenticated
  using (
    public.can_manage_overtime(auth.uid())
    or exists (select 1 from public.overtime_responses r
                where r.id = response_id and r.employee_id = public.my_employee_id())
  );

-- ---------------------------------------------------------------------------
-- 4. My Attendance: the caller's own rows, from the records that already exist
-- ---------------------------------------------------------------------------
-- No employee id is taken from the caller. Whose rows these are is decided here, from
-- the session, by `my_employee_id()` — a URL or a request body cannot name somebody else.
--
-- `null` means the login is not linked to an employee yet; the screen says so rather
-- than drawing an empty month.
create or replace function public.my_attendance(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_emp        uuid;
  v_year_from  date;
begin
  if auth.uid() is null then
    raise exception 'Sign in to see your attendance' using errcode = '42501';
  end if;
  -- The baseline is `attendance.view_own` in src/lib/permissions.ts, and must stay so.
  if not public.has_action(auth.uid(), 'attendance.view_own',
           array['admin','manager','production_office_admin','engineer',
                 'maintenance_manager','warehouse','quality_supervisor','employee']::app_role[]) then
    raise exception 'Not allowed to see attendance' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'The range must start on or before the day it ends' using errcode = '22023';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Pick a range of at most 400 days' using errcode = '22023';
  end if;

  v_emp := public.my_employee_id();
  if v_emp is null then
    return null;
  end if;

  -- Two leave years either side of today, so the balance can be counted whatever
  -- "today" the screen uses; `leaveBalance` keeps only the current one.
  v_year_from := make_date(extract(year from current_date)::int - 1, 8, 1);

  return jsonb_build_object(
    'me', (
      select jsonb_build_object(
        'id', e.id, 'full_name', e.full_name, 'employee_ref', e.employee_ref,
        'department', e.department, 'position', e.position,
        'shift_group', e.shift_group, 'started_on', e.started_on)
        from public.employees e where e.id = v_emp),
    'pattern', (
      select jsonb_build_object(
        'name', p.name, 'days', p.days, 'starts_at', p.starts_at, 'ends_at', p.ends_at,
        'break_minutes', p.break_minutes, 'annual_leave_days', p.annual_leave_days)
        from public.employees e join public.shift_patterns p on p.id = e.shift_pattern_id
       where e.id = v_emp),
    'clocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', d.on_date, 'start_time', d.start_time, 'end_time', d.end_time,
               'worked_minutes', d.worked_minutes, 'balance_minutes', d.balance_minutes,
               'scheduled_minutes', d.scheduled_minutes,
               'overtime_adj_minutes', d.overtime_adj_minutes,
               'absence_name', d.absence_name) order by d.on_date)
        from public.attendance_days d
       where d.employee_id = v_emp and d.on_date between p_from and p_to), '[]'::jsonb),
    -- How far the clock record reaches for this person. A rostered day after it is
    -- "no record yet", never "absent".
    'clocked_to', (select max(d.on_date) from public.attendance_days d where d.employee_id = v_emp),
    'clocks_imported_at', (select max(d.imported_at) from public.attendance_days d where d.employee_id = v_emp),
    'marks', coalesce((
      select jsonb_agg(jsonb_build_object('on_date', a.on_date, 'status', a.status) order by a.on_date)
        from public.employee_attendance a
       where a.employee_id = v_emp and a.on_date between p_from and p_to), '[]'::jsonb),
    'holiday_marks', coalesce((
      select jsonb_agg(a.on_date order by a.on_date)
        from public.employee_attendance a
       where a.employee_id = v_emp and a.status = 'holiday'
         and a.on_date between v_year_from and v_year_from + interval '3 years'), '[]'::jsonb),
    'board', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', b.on_date, 'shift', b.shift, 'status', b.status,
               'half_day', b.half_day) order by b.on_date)
        from public.daily_allocations b
       where b.employee_id = v_emp and b.on_date between p_from and p_to), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', r.kind, 'start_date', r.start_date, 'end_date', r.end_date,
               'status', r.status, 'working_days', r.working_days) order by r.start_date)
        from public.leave_requests r
       where r.employee_id = v_emp
         and r.start_date <= p_to and r.end_date >= p_from), '[]'::jsonb),
    -- Hours payroll recorded for this person, per period. The figure that is paid.
    'payroll', coalesce((
      select jsonb_agg(jsonb_build_object('period_id', o.period_id, 'hours', o.hours))
        from public.overtime_entries o
        join public.workforce_payroll_periods w on w.id = o.period_id
       where o.employee_id = v_emp
         and w.start_date <= p_to and w.end_date >= p_from), '[]'::jsonb),
    -- The calendar, not anybody's data: the selector needs it, and the table is
    -- readable by admin alone.
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'name', w.name, 'start_date', w.start_date, 'end_date', w.end_date)
               order by w.start_date)
        from public.workforce_payroll_periods w
       where w.start_date <= current_date + 120), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_attendance(date, date) from public;
grant execute on function public.my_attendance(date, date) to authenticated;
