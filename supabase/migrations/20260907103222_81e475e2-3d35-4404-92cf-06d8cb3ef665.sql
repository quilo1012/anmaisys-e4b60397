CREATE OR REPLACE FUNCTION public.rag_actual_is_derived()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _floor numeric;
begin
  if new.entry_date >= date '2026-07-30' then
    _floor := public.rag_actual_from_floor(new.entry_date, new.line, new.shift);
    -- The floor wins whenever production was actually logged there. When the
    -- floor has nothing for that shift, the value being written (SharePoint
    -- workbook or a manual edit) is kept instead of being wiped to zero.
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