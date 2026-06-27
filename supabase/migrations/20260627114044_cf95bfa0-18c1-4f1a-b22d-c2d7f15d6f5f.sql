CREATE OR REPLACE FUNCTION public.sync_rag_actual_from_items()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _session_id uuid;
  _date date;
  _line text;
  _shift text;
  _sum_actual numeric;
  _sum_plan numeric;
BEGIN
  _session_id := COALESCE(NEW.session_id, OLD.session_id);
  SELECT session_date, line, shift INTO _date, _line, _shift FROM public.production_sessions WHERE id = _session_id;
  IF _date IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(actual_qty), 0),
         COALESCE(SUM(COALESCE(target_qty, planned_qty)), 0)
    INTO _sum_actual, _sum_plan
  FROM public.production_items pi
  JOIN public.production_sessions ps ON ps.id = pi.session_id
  WHERE ps.session_date = _date AND ps.line = _line AND ps.shift = _shift;
  UPDATE public.rag_weekly_entries
    SET actual_qty = _sum_actual,
        plan_qty   = _sum_plan,
        updated_at = now()
  WHERE entry_date = _date AND line = _line AND shift = _shift;
  RETURN NULL;
END;
$function$;