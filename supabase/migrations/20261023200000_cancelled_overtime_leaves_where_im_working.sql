-- Cancelled overtime leaves "Where I'm working", and stays off the Headcount Board.
--
-- WHAT HAPPENED. Rosana (E129) cancelled her overtime for Mon 26/10, 06:00–18:00, on
-- 22/10 at 13:52 from My Overtime. `cancel_my_overtime` did its job: the outcome row
-- says cancelled_in_time, the audit says employee_cancelled, and her board row for
-- the 26th was removed. Her phone still listed the day as Overtime, Day shift,
-- 06:00–18:00, "Not yet assigned".
--
-- WHY. "Where I'm working" draws two lists from `my_attendance`: the board rows, and
-- `overtime[]`, the asks she is booked on (so a Day person on Night overtime sees the
-- ask's hours). `overtime[]` read every response with decision = 'accepted'. A
-- cancellation keeps decision = 'accepted' on purpose — it is the record of what was
-- agreed — and writes the cancellation to `overtime_outcomes`, which `overtime[]`
-- never looked at. So every cancelled booking came back as overtime nobody had placed.
-- On 23/10 that was 7 future bookings, 7 people. Monday is not on Rosana's rota
-- (Tue–Thu days), so nothing of her normal schedule was involved.
--
-- THE SAME HOLE ON THE BOARD. Three things put accepted answers back on the board:
-- an edited ask (`overtime_request_moved_to_board`), an ask taken back from
-- cancelled (`overtime_request_to_board`) and the backfill in 20261012190000. All
-- three call `overtime_board_apply(..., true)` for every decision = 'accepted', so
-- each of them re-adds a booking the person had already cancelled. On 23/10 four
-- such rows were on the board, all written in one go on 22/10 at 17:08 UTC, after
-- the four cancellations: the board counted four people who had said they were not
-- coming. And a supervisor recording "cancelled" through `record_overtime_outcome`
-- never took the row off at all, unlike the employee's own cancel.
--
-- THE RULE, the one the overtime code already uses for "still booked" (answer_overtime
-- overlap check, the rest-between-shifts check, My Overtime's booked list): a
-- response with decision = 'accepted' and no cancelled_in_time / cancelled_late
-- outcome. No-show and called-sick are not cancellations and are left as they were.
--
-- WHAT CHANGES
--   1. my_attendance: overtime[] leaves out cancelled bookings. The rest is the
--      production body of 23/10 (identical to 20261012200000), unchanged.
--   2. overtime_board_apply: refuses to put a cancelled booking back on the board,
--      whoever asks — so an edit, an un-cancel or a backfill cannot resurrect it.
--      Removing (p_accepted = false) is unchanged.
--   3. record_overtime_outcome: a cancellation recorded by a supervisor takes the row
--      off the board, as the employee's own cancel does; changing that outcome to
--      anything else puts it back. Promotion of the reserve is unchanged.
--   4. Repair: deletes board rows an ask wrote for bookings that were cancelled, for
--      shifts that have not started yet (London time). Only rows carrying the ask's
--      id; a planner's own row for the same person is never touched. Nothing else is
--      deleted: the responses, the outcomes and the overtime audit stay as they are.
--
-- Normal rota is not affected: rota days come from the shift pattern and from board
-- rows with no overtime_request_id, neither of which is read differently here.
--
-- Idempotent: create or replace, and a delete that finds nothing the second time.

-- ── 1. Where I'm working: a cancelled booking is not overtime ───────────────────
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
    -- The hours of each overtime shift this person is still booked on. The board row
    -- says which board; the ask says when it starts and ends, which for a Day person
    -- on Night overtime is not their rota's hours. A booking they (or a supervisor)
    -- cancelled keeps decision = 'accepted' as the record of what was agreed, so the
    -- cancellation is read from overtime_outcomes (20261023200000).
    'overtime', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', q.on_date, 'starts_at', q.starts_at, 'ends_at', q.ends_at)
               order by q.on_date, q.starts_at)
        from public.overtime_responses r
        join public.overtime_requests q on q.id = r.request_id
       where r.employee_id = v_emp and r.decision = 'accepted'
         and q.status <> 'cancelled'
         and not exists (select 1 from public.overtime_outcomes x
                          where x.response_id = r.id
                            and x.outcome in ('cancelled_in_time', 'cancelled_late'))
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

revoke all on function public.my_attendance(date, date) from public, anon;
grant execute on function public.my_attendance(date, date) to authenticated;

-- ── 2. The board never takes back a booking that was cancelled ──────────────────
create or replace function public.overtime_board_apply(p_request_id uuid, p_employee_id uuid, p_accepted boolean)
returns void
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

  -- A booking that was cancelled stays cancelled. Its decision is still 'accepted'
  -- (the record of what was agreed), so anything that replays accepted answers — an
  -- edited ask, an ask taken back from cancelled, a backfill — would otherwise put
  -- the person back on the board after they said they are not coming.
  if exists (select 1
               from public.overtime_responses r
               join public.overtime_outcomes o on o.response_id = r.id
              where r.request_id = p_request_id
                and r.employee_id = p_employee_id
                and o.outcome in ('cancelled_in_time', 'cancelled_late')) then
    return;
  end if;

  v_shift := public.overtime_board_shift(v_req.on_date, v_req.starts_at);

  -- Planned, not present: no employee_attendance here (see 20261012190000).
  insert into public.daily_allocations
    (on_date, shift, employee_id, status, area_id, is_leader, overtime_request_id)
  values
    (v_req.on_date, v_shift, p_employee_id, 'overtime', null, false, p_request_id)
  on conflict (on_date, shift, employee_id) do nothing;
end;
$$;

revoke all on function public.overtime_board_apply(uuid, uuid, boolean) from public, anon, authenticated;

-- ── 3. A supervisor's "cancelled" leaves the board too ─────────────────────────
-- Production body of 23/10, plus the board: cancel_my_overtime has always taken the
-- row off; this one did not, so a cancellation recorded at the desk stayed counted.
create or replace function public.record_overtime_outcome(p_response_id uuid, p_outcome text, p_note text default null)
returns table (promoted_response_id uuid, promoted_employee_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_req     public.overtime_requests;
  v_resp    public.overtime_responses;
  v_next    public.overtime_responses;
  v_outcome text := p_outcome;
  v_before  text;
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
  if v_outcome = 'cancelled' then
    v_starts := (v_req.on_date + v_req.starts_at)::timestamptz;
    v_outcome := case when v_hours > 0 and now() > v_starts - make_interval(hours => v_hours)
                      then 'cancelled_late' else 'cancelled_in_time' end;
  end if;
  select o.outcome into v_before from public.overtime_outcomes o where o.response_id = p_response_id;
  insert into public.overtime_outcomes (response_id, outcome, note, recorded_by, recorded_at)
  values (p_response_id, v_outcome, p_note, auth.uid(), now())
  on conflict (response_id) do update
    set outcome = excluded.outcome, note = excluded.note,
        recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at;
  -- The board follows the booking: a cancellation takes the row off, as the
  -- employee's own cancel does; undoing a cancellation puts it back.
  if v_resp.decision = 'accepted' then
    if v_outcome in ('cancelled_in_time', 'cancelled_late') then
      perform public.overtime_board_apply(v_req.id, v_resp.employee_id, false);
    elsif v_before in ('cancelled_in_time', 'cancelled_late') then
      perform public.overtime_board_apply(v_req.id, v_resp.employee_id, true);
    end if;
  end if;
  if v_resp.decision = 'accepted' and v_outcome <> 'attended' and v_req.status = 'open' then
    select * into v_next
      from public.overtime_responses r
     where r.request_id = v_req.id and r.decision = 'reserve' and r.answer = 'yes'
       and not exists (select 1 from public.overtime_outcomes o where o.response_id = r.id)
     order by r.answered_at limit 1 for update skip locked;
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

-- ── 4. Repair: take back off the board what a replay put there ──────────────────
-- Only rows an ask wrote (overtime_request_id), only for a booking whose outcome is a
-- cancellation, only for shifts that have not started. Responses, outcomes and the
-- overtime audit are not touched.
do $$
declare v_n integer;
begin
  delete from public.daily_allocations b
   using public.overtime_responses r, public.overtime_outcomes o, public.overtime_requests q
   where b.overtime_request_id = r.request_id
     and b.employee_id = r.employee_id
     and o.response_id = r.id
     and o.outcome in ('cancelled_in_time', 'cancelled_late')
     and q.id = r.request_id
     and (q.on_date + q.starts_at) > (now() at time zone 'Europe/London');
  get diagnostics v_n = row_count;
  raise notice 'Cancelled bookings taken off the Headcount Board: %', v_n;
end $$;

notify pgrst, 'reload schema';
