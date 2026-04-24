CREATE OR REPLACE FUNCTION public.reopen_wo_as_recurrence(_wo_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _user_id uuid := auth.uid();
  _user_role public.app_role;
  _user_name text;
  _orig record;
  _new_id uuid;
  _new_number int;
  _note text;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, wo_number, requester_name, machine, description, priority,
         operator_id, line_id, mobile_asset_id, status, notes
    INTO _orig
    FROM public.work_orders
   WHERE id = _wo_id;

  IF _orig.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_found');
  END IF;

  IF _orig.status::text NOT IN ('finished', 'closed', 'completed', 'force_closed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_closed');
  END IF;

  -- Permission: admin, manager, or the original operator
  SELECT public.current_user_role() INTO _user_role;
  IF NOT (
    _user_role IN ('admin'::public.app_role, 'manager'::public.app_role)
    OR _orig.operator_id = _user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT COALESCE(name, email) INTO _user_name
    FROM public.profiles WHERE id = _user_id;
  _user_name := COALESCE(_user_name, 'Operator');

  _note := '[Recurrence of WO-' || lpad(_orig.wo_number::text, 6, '0')
        || ' — ' || to_char(now() AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI')
        || ' — ' || _user_name || '] '
        || COALESCE(NULLIF(_reason, ''), 'Same problem reported again');

  INSERT INTO public.work_orders (
    requester_name, machine, description, priority,
    operator_id, line_id, mobile_asset_id,
    recurrence_of_wo_id, status, notes
  )
  VALUES (
    _orig.requester_name, _orig.machine, _orig.description,
    COALESCE(_orig.priority, 'medium'),
    _orig.operator_id, _orig.line_id, _orig.mobile_asset_id,
    _orig.id, 'open'::wo_status, _note
  )
  RETURNING id, wo_number INTO _new_id, _new_number;

  RETURN jsonb_build_object(
    'success', true,
    'new_wo_id', _new_id,
    'new_wo_number', _new_number,
    'original_wo_id', _orig.id,
    'original_wo_number', _orig.wo_number
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reopen_wo_as_recurrence(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reopen_wo_as_recurrence(uuid, text) TO authenticated;