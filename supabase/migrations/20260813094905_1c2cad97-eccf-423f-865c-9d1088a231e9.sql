CREATE OR REPLACE FUNCTION public.has_action(
  _uid uuid,
  _action text,
  _baseline app_role[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    LEFT JOIN public.role_permission_overrides o
      ON o.role = ur.role AND o.action = _action
    WHERE ur.user_id = _uid
      AND COALESCE(
            CASE WHEN ur.role = 'admin'::app_role THEN true ELSE o.allowed END,
            ur.role = ANY (_baseline)
          )
  );
$$;

REVOKE ALL ON FUNCTION public.has_action(uuid, text, app_role[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_action(uuid, text, app_role[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.correct_downtime_event(
  _event_id uuid,
  _stopped_at timestamptz,
  _resumed_at timestamptz,
  _minutes integer,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev              public.downtime_events%ROWTYPE;
  v_name          text;
  v_wo_number     text;
  v_prev_minutes  integer;
  v_new_resumed   timestamptz;
  v_new_minutes   integer;
BEGIN
  IF NOT public.has_action(auth.uid(), 'downtime.correct', ARRAY['admin','maintenance_manager']::app_role[]) THEN
    RAISE EXCEPTION 'Not allowed to correct downtime';
  END IF;

  SELECT * INTO ev FROM public.downtime_events WHERE id = _event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Downtime event not found';
  END IF;

  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  IF _stopped_at IS NULL THEN
    RAISE EXCEPTION 'Start time is required';
  END IF;

  IF _stopped_at > now() THEN
    RAISE EXCEPTION 'Start time cannot be in the future';
  END IF;

  IF _minutes IS NOT NULL THEN
    IF ev.resumed_at IS NULL THEN
      RAISE EXCEPTION 'This stoppage is still open — resume the line before setting a duration';
    END IF;
    IF _minutes < 0 THEN
      RAISE EXCEPTION 'Duration cannot be negative';
    END IF;
    v_new_minutes := _minutes;
    v_new_resumed := _stopped_at + make_interval(mins => _minutes);
  ELSIF _resumed_at IS NOT NULL THEN
    v_new_resumed := _resumed_at;
    v_new_minutes := round(EXTRACT(EPOCH FROM (_resumed_at - _stopped_at)) / 60.0);
  ELSE
    v_new_resumed := NULL;
    v_new_minutes := NULL;
  END IF;

  IF v_new_resumed IS NOT NULL AND v_new_resumed < _stopped_at THEN
    RAISE EXCEPTION 'End time cannot be before the start time';
  END IF;

  IF v_new_minutes IS NOT NULL AND v_new_minutes < 0 THEN
    RAISE EXCEPTION 'Duration cannot be negative';
  END IF;

  UPDATE public.downtime_events
     SET stopped_at = _stopped_at,
         resumed_at = v_new_resumed
   WHERE id = _event_id;

  SELECT duration_minutes INTO v_new_minutes
    FROM public.downtime_events
   WHERE id = _event_id;

  v_prev_minutes := COALESCE(
    ev.duration_minutes,
    CASE WHEN ev.resumed_at IS NOT NULL
      THEN round(EXTRACT(EPOCH FROM (ev.resumed_at - ev.stopped_at)) / 60.0)::int
    END
  );

  SELECT COALESCE(p.name, 'Unknown') INTO v_name FROM public.profiles p WHERE p.id = auth.uid();
  v_name := COALESCE(v_name, 'Unknown');

  SELECT wo.wo_number INTO v_wo_number FROM public.work_orders wo WHERE wo.id = ev.work_order_id;

  INSERT INTO public.downtime_corrections (
    downtime_event_id, work_order_id, corrected_by, corrected_by_name,
    prev_stopped_at, prev_resumed_at, prev_duration_minutes,
    new_stopped_at, new_resumed_at, new_duration_minutes, reason
  ) VALUES (
    _event_id, ev.work_order_id, auth.uid(), v_name,
    ev.stopped_at, ev.resumed_at, v_prev_minutes,
    _stopped_at, v_new_resumed, v_new_minutes, btrim(_reason)
  );

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(), v_name, 'downtime_corrected', 'downtime_event', _event_id::text,
    jsonb_build_object(
      'work_order_id', ev.work_order_id,
      'wo_number', v_wo_number,
      'prev_stopped_at', ev.stopped_at,
      'prev_resumed_at', ev.resumed_at,
      'prev_minutes', v_prev_minutes,
      'new_stopped_at', _stopped_at,
      'new_resumed_at', v_new_resumed,
      'new_minutes', v_new_minutes,
      'reason', btrim(_reason)
    )
  );

  RETURN jsonb_build_object(
    'wo_number', v_wo_number,
    'prev_minutes', v_prev_minutes,
    'new_minutes', v_new_minutes,
    'corrected_by_name', v_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.correct_downtime_event(uuid, timestamptz, timestamptz, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_downtime_event(uuid, timestamptz, timestamptz, integer, text) TO authenticated;