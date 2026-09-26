alter table public.daily_allocations
  add column if not exists sheet_name text null,
  add column if not exists sheet_start_time text null,
  add column if not exists sheet_tag text null;

drop function if exists public.line_team_board(uuid);

create function public.line_team_board(p_line_id uuid)
returns table(
  employee_name text,
  display_name text,
  status text,
  is_leader boolean,
  half_day boolean,
  note text,
  shift text,
  on_date date,
  sheet_start_time text,
  sheet_tag text,
  area_name text,
  area_sort integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_line_name text;
  v_area_ids uuid[];
  v_now timestamp := now() at time zone 'Europe/London';
  v_shift text;
  v_date date;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

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

  -- Areas linked to the line by FK; all of them (a line can have several columns).
  select array_agg(a.id) into v_area_ids
  from public.headcount_areas a
  where a.active and a.line_id = p_line_id;

  -- Fallback: no area carries line_id, match by name / sheet_label.
  if v_area_ids is null then
    select array_agg(a.id) into v_area_ids
    from public.headcount_areas a
    where a.active
      and (lower(a.name) = lower(v_line_name)
        or exists (
          select 1 from unnest(string_to_array(coalesce(a.sheet_label,''), ',')) s
          where lower(trim(s)) = lower(v_line_name)
        ));
  end if;

  if v_now::time >= time '06:00' and v_now::time < time '18:00' then
    v_shift := 'Day';  v_date := v_now::date;
  elsif v_now::time >= time '18:00' then
    v_shift := 'Night'; v_date := v_now::date;
  else
    v_shift := 'Night'; v_date := v_now::date - 1;
  end if;

  return query
  select
    e.full_name,
    coalesce(da.sheet_name, e.full_name),
    da.status,
    coalesce(da.is_leader, false),
    coalesce(da.half_day, false),
    da.note,
    da.shift,
    da.on_date,
    da.sheet_start_time,
    da.sheet_tag,
    a.name,
    a.sort_order
  from public.daily_allocations da
  join public.employees e on e.id = da.employee_id
  join public.headcount_areas a on a.id = da.area_id
  where da.on_date = v_date
    and da.shift = v_shift
    and da.area_id = any(coalesce(v_area_ids, array[]::uuid[]))
  order by a.sort_order, coalesce(da.is_leader, false) desc, coalesce(da.sheet_name, e.full_name);
end;
$$;

revoke all on function public.line_team_board(uuid) from public, anon;
grant execute on function public.line_team_board(uuid) to authenticated;