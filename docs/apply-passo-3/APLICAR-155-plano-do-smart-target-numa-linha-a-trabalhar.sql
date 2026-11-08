-- BLOCO 155 — colar no SQL Editor do projeto AN Maintenance (Supabase), não no Lovable.
-- A running line with no plan from SharePoint takes the Smart Target as its plan, until
-- SharePoint has one.
--
-- Owner's decision, 08/11/2026: if SharePoint has no plan for a line and shift, and the line
-- is running, it takes the Smart Target number so it has a target and its performance can be
-- measured. When SharePoint later brings a plan, that plan replaces the Smart Target.
--
-- "Running" means a production session exists for that date, line and shift (the line was
-- started on its tablet). The Smart Target forecasts all six lines every shift, Saturday
-- night included, so a forecast alone does not mean the line is working; filling idle lines
-- would show them red against a plan nobody had.
--
-- Where a plan came from is kept in rag_weekly_entries.plan_source:
--   'sharepoint'   written by Sync from SharePoint
--   'workbook'     written by the Excel workbook import
--   'smart_target' filled from smart_target_forecasts because the plan was empty
--   'manual'       typed on the RAG board, or any other write that changed the plan
--
-- What does NOT happen:
--   - A plan somebody typed (manual) is never replaced by a Smart Target, not even a 0:
--     typing 0 on purpose says "this line is not running", and it stays 0.
--   - A Smart Target with no number (expected_total null) fills nothing.
--   - Plans stored before today are not rewritten.
--   - Nothing writes production_items here: the existing sync_items_target_from_rag trigger
--     spreads the plan over the session's items, exactly as it does for a SharePoint plan.
--
-- Fires from three places, so it does not matter which arrives first:
--   1. a RAG entry is written with an empty plan (e.g. Sync from SharePoint with no plan);
--   2. a Smart Target gets its number;
--   3. a production session starts.

alter table public.rag_weekly_entries
  add column if not exists plan_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rag_weekly_entries_plan_source_check') then
    alter table public.rag_weekly_entries
      add constraint rag_weekly_entries_plan_source_check
      check (plan_source is null or plan_source in ('sharepoint', 'workbook', 'smart_target', 'manual'));
  end if;
end $$;

comment on column public.rag_weekly_entries.plan_source is
  'Where plan_qty came from: sharepoint, workbook, smart_target (filled because a running line had no plan) or manual.';

-- The Smart Target number for a running line and shift, or null.
create or replace function public.rag_smart_target_plan(p_date date, p_line text, p_shift text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select f.expected_total::numeric
    from public.smart_target_forecasts f
   where f.session_date = p_date
     and f.shift = p_shift
     and p_line ~ '^Line [1-6]$'
     and f.line = substring(p_line from '^Line ([1-6])$')::integer
     and f.expected_total is not null
     and f.expected_total > 0
     and exists (select 1 from public.production_sessions s
                  where s.session_date = p_date and s.line = p_line and s.shift = p_shift)
   limit 1
$$;

revoke all on function public.rag_smart_target_plan(date, text, text) from public, anon, authenticated;

-- Fill one line and shift from its Smart Target, if it is running and its plan is empty and
-- nobody set it. Creates the RAG entry when there is none.
create or replace function public.rag_fill_plan_from_smart_target(p_date date, p_line text, p_shift text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_smart numeric := public.rag_smart_target_plan(p_date, p_line, p_shift);
begin
  if v_smart is null then
    return;
  end if;

  update public.rag_weekly_entries e
     set plan_qty = v_smart,
         plan_source = 'smart_target'
   where e.entry_date = p_date
     and e.line = p_line
     and e.shift = p_shift
     and coalesce(e.plan_qty, 0) = 0
     and e.plan_source is distinct from 'manual';

  insert into public.rag_weekly_entries (entry_date, line, shift, plan_qty, plan_source)
  values (p_date, p_line, p_shift, v_smart, 'smart_target')
  on conflict (entry_date, line, shift) do nothing;
end;
$$;

revoke all on function public.rag_fill_plan_from_smart_target(date, text, text) from public, anon, authenticated;

-- 1. Every write that touches a RAG plan: say where it came from, and fill an empty plan
--    from the Smart Target unless a person set it.
create or replace function public.rag_plan_source_and_smart_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_smart numeric;
  v_plan_changed boolean;
begin
  v_plan_changed := tg_op = 'INSERT' or new.plan_qty is distinct from old.plan_qty;

  if v_plan_changed and coalesce(new.plan_qty, 0) > 0 then
    -- A plan arrived. Keep the source the writer gave; a write that did not say is manual.
    if tg_op = 'INSERT' then
      new.plan_source := coalesce(new.plan_source, 'manual');
    elsif new.plan_source is not distinct from old.plan_source then
      new.plan_source := 'manual';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and v_plan_changed and new.plan_source is not distinct from old.plan_source then
    -- Somebody cleared the plan by hand: 0 on purpose means "not running", and stays 0.
    new.plan_source := 'manual';
    return new;
  end if;

  -- The plan is empty. A person's 0 stays; anything else may take the Smart Target.
  if coalesce(new.plan_qty, 0) = 0 and new.plan_source is distinct from 'manual' then
    v_smart := public.rag_smart_target_plan(new.entry_date, new.line, new.shift);
    if v_smart is not null then
      new.plan_qty := v_smart;
      new.plan_source := 'smart_target';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rag_plan_source_and_smart_fill on public.rag_weekly_entries;
create trigger trg_rag_plan_source_and_smart_fill
  before insert or update of plan_qty, plan_source on public.rag_weekly_entries
  for each row execute function public.rag_plan_source_and_smart_fill();

-- 2. A Smart Target that gets its number.
create or replace function public.smart_target_fills_rag_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.expected_total is null or new.expected_total <= 0 then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.expected_total is not distinct from new.expected_total then
    return null;
  end if;
  perform public.rag_fill_plan_from_smart_target(new.session_date, 'Line ' || new.line::text, new.shift);
  return null;
end;
$$;

drop trigger if exists trg_smart_target_fills_rag_plan on public.smart_target_forecasts;
create trigger trg_smart_target_fills_rag_plan
  after insert or update of expected_total on public.smart_target_forecasts
  for each row execute function public.smart_target_fills_rag_plan();

-- 3. A production session that starts.
create or replace function public.session_start_fills_rag_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rag_fill_plan_from_smart_target(new.session_date, new.line, new.shift);
  return null;
end;
$$;

drop trigger if exists trg_session_start_fills_rag_plan on public.production_sessions;
create trigger trg_session_start_fills_rag_plan
  after insert on public.production_sessions
  for each row execute function public.session_start_fills_rag_plan();

-- The workbook import says where its plans came from.
create or replace function public.import_rag_plan_workbook(_updates jsonb default '[]'::jsonb, _inserts jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  _updated integer := 0;
  _created integer := 0;
begin
  if jsonb_typeof(coalesce(_updates, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(_inserts, '[]'::jsonb)) <> 'array' then
    raise exception 'import_rag_plan_workbook expects two JSON arrays';
  end if;

  -- A NULL upm_target in the payload means "the file had nothing there" and the
  -- stored value is kept. The DISTINCT FROM guard keeps the count honest and
  -- stops the audit trigger firing for rows that did not actually move.
  update public.rag_weekly_entries e
     set plan_qty    = coalesce(v.plan_qty, e.plan_qty),
         upm_target  = coalesce(v.upm_target, e.upm_target),
         plan_source = case when coalesce(v.plan_qty, 0) > 0 then 'workbook' else e.plan_source end
    from jsonb_to_recordset(coalesce(_updates, '[]'::jsonb))
      as v(id uuid, plan_qty numeric, upm_target numeric)
   where e.id = v.id
     and (
       e.plan_qty is distinct from coalesce(v.plan_qty, e.plan_qty)
       or e.upm_target is distinct from coalesce(v.upm_target, e.upm_target)
     );
  get diagnostics _updated = row_count;

  insert into public.rag_weekly_entries (entry_date, line, shift, plan_qty, upm_target, created_by, plan_source)
  select n.entry_date, n.line, n.shift, n.plan_qty, coalesce(n.upm_target, 0), auth.uid(),
         case when coalesce(n.plan_qty, 0) > 0 then 'workbook' end
    from jsonb_to_recordset(coalesce(_inserts, '[]'::jsonb))
      as n(entry_date date, line text, shift text, plan_qty numeric, upm_target numeric)
   on conflict (entry_date, line, shift) do nothing;
  get diagnostics _created = row_count;

  return jsonb_build_object('updated', _updated, 'created', _created);
end;
$function$;
