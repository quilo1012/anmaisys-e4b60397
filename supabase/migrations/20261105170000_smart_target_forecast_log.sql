-- Smart Target: every forecast, frozen once per shift, so its error can be measured.
--
-- WHY. Smart Target's numbers are labelled provisional and nobody was measuring whether
-- they hit. This keeps, per date, shift and line, the forecast as it stood when the page
-- first computed it during that shift. The page then compares it with what was logged
-- once the shift closes. Decided 05/11 (Q27a, Q28a).
--
-- WHAT IS STORED. The total, the status and confidence, the line's performance factor
-- and how many shifts it rested on, each job's contribution, the engine version, and
-- whether the line's number was SHOWN. Lines 1, 3 and 6 are held back on the page but
-- their forecasts are kept too, in shadow, because without them there is never evidence
-- to switch them on. Nothing is scored here: the actual is read at view time, so changing
-- where the actual comes from later (iTouch events instead of operator logs) never
-- rewrites history.
--
-- ONCE PER SHIFT AND LINE, FIRST WINS. save_smart_target_forecasts() inserts each line
-- only if that line has no forecast for the shift yet. A forecast frozen at 14:00 is kept
-- but the page leaves it out of the error, because it already knows half the answer
-- (Q29a: only the first two hours of a shift count).
--
-- WHO. Reading and saving follow the page: smarttarget.view. Writing only through the
-- function. No anon access.

create table if not exists public.smart_target_forecasts (
  id               uuid primary key default gen_random_uuid(),
  session_date     date not null,
  shift            text not null check (shift in ('DAY', 'NIGHT')),
  line             integer not null check (line between 1 and 6),
  shown            boolean not null,
  expected_total   integer,
  status           text not null,
  confidence       text not null,
  factor           numeric,
  factor_shifts    integer,
  jobs             jsonb not null default '[]'::jsonb,
  engine_version   text not null,
  frozen_at        timestamptz not null default now(),
  frozen_by        uuid,
  unique (session_date, shift, line)
);

alter table public.smart_target_forecasts enable row level security;

revoke all on public.smart_target_forecasts from anon, public;
grant select on public.smart_target_forecasts to authenticated;
grant all on public.smart_target_forecasts to service_role;

drop policy if exists "smart_target_forecasts read with smart target"
  on public.smart_target_forecasts;
create policy "smart_target_forecasts read with smart target"
  on public.smart_target_forecasts
  for select
  to authenticated
  using (public.has_action((select auth.uid()), 'smarttarget.view',
                           array['admin', 'production_office_admin']::app_role[]));

create or replace function public.save_smart_target_forecasts(p_date date, p_shift text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'smarttarget.view',
                              array['admin', 'production_office_admin']::app_role[]) then
    raise exception 'Not allowed to save Smart Target forecasts.' using errcode = '42501';
  end if;
  if p_shift not in ('DAY', 'NIGHT') then
    raise exception 'Shift must be DAY or NIGHT.' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'The forecasts must be a list.' using errcode = '22023';
  end if;

  insert into public.smart_target_forecasts
    (session_date, shift, line, shown, expected_total, status, confidence, factor,
     factor_shifts, jobs, engine_version, frozen_by)
  select p_date, p_shift,
         (r->>'line')::integer,
         coalesce((r->>'shown')::boolean, false),
         nullif(r->>'expected_total', '')::integer,
         coalesce(nullif(r->>'status', ''), 'insufficient_data'),
         coalesce(nullif(r->>'confidence', ''), 'none'),
         nullif(r->>'factor', '')::numeric,
         nullif(r->>'factor_shifts', '')::integer,
         coalesce(r->'jobs', '[]'::jsonb),
         coalesce(nullif(r->>'engine_version', ''), 'unknown'),
         auth.uid()
    from jsonb_array_elements(p_rows) as r
   where (r->>'line') ~ '^[1-6]$'
  on conflict (session_date, shift, line) do nothing;

  get diagnostics v_inserted = row_count;
  return jsonb_build_object('saved', v_inserted);
end;
$$;

revoke all on function public.save_smart_target_forecasts(date, text, jsonb) from public, anon;
grant execute on function public.save_smart_target_forecasts(date, text, jsonb) to authenticated;
