create or replace function public.line_team_board(p_line_id uuid)
returns table(
  employee_name text,
  status text,
  is_leader boolean,
  half_day boolean,
  note text,
  shift text,
  on_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_line_name text;
  v_area_id uuid;
  v_now timestamp := now() at time zone 'Europe/London';
  v_shift text;
  v_date date;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  -- An operator account may only read the team of a line its login is bound to.
  -- Staff roles that already run the headcount board may read any line.
  if not (
    exists (
      select 1 from public.operator_line_accounts ola
      where ola.user_id = v_caller and p_line_id = any(ola.line_ids)
    )
    or public.has_any_role(v_caller, array['admin','manager','maintenance_manager','supervisor','planner','production_office_admin']::app_role[])
  ) then
    raise exception 'not allowed to read this line''s team';
  end if;

  select l.name into v_line_name from public.lines l where l.id = p_line_id;
  if v_line_name is null then
    raise exception 'unknown line';
  end if;

  -- The headcount board draws its columns from headcount_areas; the line and the
  -- area share a name (Line 6 = Line 6). sheet_label is the spreadsheet spelling,
  -- tried as a fallback so a renamed column still resolves.
  select a.id into v_area_id
  from public.headcount_areas a
  where a.active
    and (lower(a.name) = lower(v_line_name) or lower(coalesce(a.sheet_label,'')) = lower(v_line_name))
  order by a.sort_order
  limit 1;

  -- Factory clock: Day runs 06:00-18:00 London; before 06:00 is still last
  -- night's board, the same rule the rest of the system applies.
  if v_now::time >= time '06:00' and v_now::time < time '18:00' then
    v_shift := 'Day';
    v_date := v_now::date;
  elsif v_now::time >= time '18:00' then
    v_shift := 'Night';
    v_date := v_now::date;
  else
    v_shift := 'Night';
    v_date := v_now::date - 1;
  end if;

  return query
  select
    e.full_name,
    da.status,
    coalesce(da.is_leader, false),
    coalesce(da.half_day, false),
    da.note,
    da.shift,
    da.on_date
  from public.daily_allocations da
  join public.employees e on e.id = da.employee_id
  where da.on_date = v_date
    and da.shift = v_shift
    and da.area_id = v_area_id
  order by coalesce(da.is_leader, false) desc, e.full_name;
end;
$$;

revoke all on function public.line_team_board(uuid) from public;
grant execute on function public.line_team_board(uuid) to authenticated;