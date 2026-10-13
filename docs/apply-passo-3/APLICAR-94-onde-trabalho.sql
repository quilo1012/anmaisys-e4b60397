-- My Attendance says where: the board column for each day, and the hours of overtime.
--
-- The employee could see that they were due on the 14th and not where. The board
-- already knows — `daily_allocations.area_id`, one row per person per day and shift —
-- and `my_attendance` returned the row without it. Nothing new is stored: the same
-- rows the Headcount Board draws, with the column's name joined on, so the phone and
-- the board cannot disagree. A supervisor moving somebody on the board moves them on
-- the phone at the next load.
--
-- Two additions to the jsonb, both new keys, so the screen running before this is
-- pasted keeps working and the screen running after it before this is pasted shows
-- no work area rather than a wrong one:
--   board[].area / area_kind / is_leader   — the column, by the name the board uses
--   overtime[]                              — accepted overtime asks: date and hours
--
-- Still only the caller's own rows: `my_employee_id()` decides whose, as before.
-- Everything else in the function is 20261012160000 unchanged.
--
-- Idempotent.

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
    -- Where: the board column the row is in, by the name the board heads it with.
    -- Null when the row has no column (an absence, or overtime nobody has placed yet)
    -- — the screen says "not yet assigned" rather than guessing from the department.
    'board', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', b.on_date, 'shift', b.shift, 'status', b.status,
               'half_day', b.half_day, 'area', h.name, 'area_kind', h.kind,
               'is_leader', b.is_leader) order by b.on_date, b.shift)
        from public.daily_allocations b
        left join public.headcount_areas h on h.id = b.area_id
       where b.employee_id = v_emp and b.on_date between p_from and p_to), '[]'::jsonb),
    -- The hours of each overtime shift a supervisor accepted this person for. The
    -- board row says which board; the ask says when it starts and ends, which for a
    -- Day person on Night overtime is not their rota's hours.
    'overtime', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', q.on_date, 'starts_at', q.starts_at, 'ends_at', q.ends_at)
               order by q.on_date, q.starts_at)
        from public.overtime_responses r
        join public.overtime_requests q on q.id = r.request_id
       where r.employee_id = v_emp and r.decision = 'accepted'
         and q.status <> 'cancelled'
         and q.on_date between p_from and p_to), '[]'::jsonb),
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
