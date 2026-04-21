-- Add a SECURITY DEFINER RPC to log a recurrence event WITHOUT reopening the WO
-- Avoids the work_orders_locked_engineer_id_fkey violation that occurs when
-- the prior engineer's profile is missing.

CREATE OR REPLACE FUNCTION public.log_wo_retrigger(_wo_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _user_id  uuid := auth.uid();
  _user_name text;
  _wo_number int;
  _retrigger_count int;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT wo_number INTO _wo_number FROM public.work_orders WHERE id = _wo_id;
  IF _wo_number IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_found');
  END IF;

  SELECT COALESCE(name, email) INTO _user_name
    FROM public.profiles WHERE id = _user_id;
  _user_name := COALESCE(_user_name, 'Operator');

  -- Append a log line (timeline / history)
  INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
  VALUES (
    _wo_id,
    _user_id,
    _user_name,
    'problem_retriggered: ' || COALESCE(NULLIF(_reason, ''), 'Same problem reported again')
  );

  -- Append a note line on the WO itself so it shows in Observations
  UPDATE public.work_orders
     SET notes = COALESCE(notes, '') ||
                 CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END ||
                 '[Retriggered — ' || to_char(now() AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') ||
                 ' — ' || _user_name || '] ' || COALESCE(NULLIF(_reason,''), 'Same problem reported again')
   WHERE id = _wo_id;

  -- Count retriggers for this WO
  SELECT COUNT(*) INTO _retrigger_count
    FROM public.work_order_logs
   WHERE work_order_id = _wo_id
     AND action LIKE 'problem_retriggered%';

  RETURN jsonb_build_object(
    'success', true,
    'wo_number', _wo_number,
    'retrigger_count', _retrigger_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.log_wo_retrigger(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_wo_retrigger(uuid, text) TO authenticated;