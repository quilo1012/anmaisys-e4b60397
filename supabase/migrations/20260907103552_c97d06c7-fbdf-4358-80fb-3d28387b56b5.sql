ALTER TABLE public.rag_weekly_entries
  ADD COLUMN IF NOT EXISTS actual_source text NOT NULL DEFAULT 'manual';

CREATE OR REPLACE FUNCTION public.rag_actual_is_derived()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _floor numeric;
begin
  -- SharePoint is the master source: whatever the workbook says wins.
  if coalesce(new.actual_source, 'manual') = 'sharepoint' then
    new.actual_qty := coalesce(new.actual_qty, 0);
    return new;
  end if;

  if new.entry_date >= date '2026-07-30' then
    _floor := public.rag_actual_from_floor(new.entry_date, new.line, new.shift);
    if coalesce(_floor, 0) > 0 then
      new.actual_qty := _floor;
    else
      new.actual_qty := coalesce(new.actual_qty, 0);
    end if;
  elsif tg_op = 'UPDATE' then
    new.actual_qty := old.actual_qty;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.rag_refresh_actual_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _sid uuid := coalesce(new.session_id, old.session_id);
        _d date; _line text; _shift text;
begin
  select s.session_date, s.line, s.shift into _d, _line, _shift
  from public.production_sessions s where s.id = _sid;
  if _d is null or _d < date '2026-07-30' then return coalesce(new, old); end if;
  update public.rag_weekly_entries r
  set actual_qty = public.rag_actual_from_floor(_d, _line, _shift), updated_at = now()
  where r.entry_date = _d
    and coalesce(r.actual_source, 'manual') <> 'sharepoint'
    and upper(btrim(r.shift)) = upper(btrim(_shift))
    and lower(replace(btrim(r.line), ' ', '')) = lower(replace(btrim(_line), ' ', ''));
  return coalesce(new, old);
end $function$;