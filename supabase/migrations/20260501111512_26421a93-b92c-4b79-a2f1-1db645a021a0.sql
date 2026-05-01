-- 1) accept_wo_with_pin: also stamp accepted_at on the current open episode
CREATE OR REPLACE FUNCTION public.accept_wo_with_pin(_wo_id uuid, _pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _user_id UUID := auth.uid();
  _pin_valid BOOLEAN;
  _wo_locked UUID;
  _engineer_name TEXT;
  _current_ep INT;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT public.verify_engineer_pin(_user_id, _pin) INTO _pin_valid;
  IF NOT COALESCE(_pin_valid, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin');
  END IF;

  SELECT locked_engineer_id, current_episode INTO _wo_locked, _current_ep
    FROM public.work_orders WHERE id = _wo_id;
  IF _wo_locked IS NOT NULL AND _wo_locked <> _user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'locked_to_other');
  END IF;

  SELECT name INTO _engineer_name FROM public.profiles WHERE id = _user_id;

  UPDATE public.work_orders SET
    status = 'received'::wo_status,
    engineer_id = _user_id,
    engineer_name = _engineer_name,
    locked_engineer_id = _user_id,
    locked_at = COALESCE(locked_at, now()),
    received_at = COALESCE(received_at, now())
  WHERE id = _wo_id;

  -- Stamp accepted_at on the open episode (if any)
  UPDATE public.wo_episodes
     SET accepted_at = COALESCE(accepted_at, now())
   WHERE work_order_id = _wo_id
     AND finished_at IS NULL;

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _user_id, COALESCE(_engineer_name, 'Engineer'), 'received');
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'engineer_id', _user_id, 'engineer_name', _engineer_name);
END;
$function$;

-- 2) finish_wo_with_pin: also close any open episode on this WO
CREATE OR REPLACE FUNCTION public.finish_wo_with_pin(_wo_id uuid, _pin text, _signed_by_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _user_id UUID := auth.uid();
  _pin_valid BOOLEAN;
  _wo_locked UUID;
  _engineer_name TEXT;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT public.verify_engineer_pin(_user_id, _pin) INTO _pin_valid;
  IF NOT COALESCE(_pin_valid, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin');
  END IF;

  SELECT locked_engineer_id INTO _wo_locked
    FROM public.work_orders WHERE id = _wo_id;
  IF _wo_locked IS NOT NULL AND _wo_locked <> _user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'locked_to_other');
  END IF;

  SELECT name INTO _engineer_name FROM public.profiles WHERE id = _user_id;

  UPDATE public.work_orders SET
    status = 'finished'::wo_status,
    finished_at = now(),
    signed_by_name = COALESCE(_signed_by_name, signed_by_name)
  WHERE id = _wo_id;

  -- Close any open episode for this WO so the next recurrence can reopen cleanly
  UPDATE public.wo_episodes
     SET finished_at = COALESCE(finished_at, now()),
         finish_engineer_id = COALESCE(finish_engineer_id, _user_id),
         finish_pin_verified = true
   WHERE work_order_id = _wo_id
     AND finished_at IS NULL;

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _user_id, COALESCE(_engineer_name, 'Engineer'), 'finished');
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 3) reopen_wo_as_recurrence: harden episode finalization (close ALL open episodes first)
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
  _new_episode int;
  _note text;
  _is_same_line_operator boolean := false;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT id, wo_number, requester_name, machine, description, priority,
         operator_id, line_id, mobile_asset_id, status, notes,
         engineer_id, engineer_name, current_episode, reopen_count
    INTO _orig
    FROM public.work_orders
   WHERE id = _wo_id;

  IF _orig.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_found');
  END IF;

  IF _orig.status::text NOT IN ('finished', 'closed', 'completed', 'force_closed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_closed');
  END IF;

  SELECT public.current_user_role() INTO _user_role;

  IF _orig.line_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.operator_line_accounts ola
      WHERE ola.user_id = _user_id
        AND _orig.line_id = ANY(ola.line_ids)
    ) INTO _is_same_line_operator;
  END IF;

  IF NOT (
    _user_role IN ('admin'::public.app_role, 'manager'::public.app_role)
    OR _orig.operator_id = _user_id
    OR (_user_role = 'operator'::public.app_role AND _is_same_line_operator)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT COALESCE(p.name, p.email, 'Operator') INTO _user_name
    FROM public.profiles p WHERE p.id = _user_id;
  _user_name := COALESCE(NULLIF(_user_name, ''), 'Operator');

  -- Close ANY leftover open episode (by current_episode OR by finished_at IS NULL)
  UPDATE public.wo_episodes
    SET finished_at = COALESCE(finished_at, now())
    WHERE work_order_id = _wo_id
      AND finished_at IS NULL;

  SELECT COALESCE(MAX(episode_number), 0) + 1 INTO _new_episode
    FROM public.wo_episodes WHERE work_order_id = _wo_id;

  INSERT INTO public.wo_episodes
    (work_order_id, episode_number, reopened_by, reopen_reason, accepted_at)
  VALUES (_wo_id, _new_episode, _user_id, _reason, NULL);

  _note := '[Reopened (recurrence) — ' || to_char(now() AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI')
        || ' — ' || _user_name || '] '
        || COALESCE(NULLIF(_reason, ''), 'Same problem reported again');

  UPDATE public.work_orders SET
    status = 'open'::wo_status,
    reopen_count = COALESCE(reopen_count, 0) + 1,
    current_episode = _new_episode,
    locked_engineer_id = _orig.engineer_id,
    engineer_id = _orig.engineer_id,
    engineer_name = _orig.engineer_name,
    received_at = NULL,
    arrived_at = NULL,
    started_at = NULL,
    finished_at = NULL,
    closed_at = NULL,
    closed_by = NULL,
    completed_at = NULL,
    signed_by_name = NULL,
    line_stopped = true,
    line_stopped_at = now(),
    line_stopped_by = _user_id,
    line_resumed_at = NULL,
    line_resumed_by = NULL,
    notes = COALESCE(notes, '') ||
            CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END || _note
  WHERE id = _wo_id;

  INSERT INTO public.downtime_events
    (work_order_id, stopped_at, stopped_by, stopped_by_name, stopped_reason,
     is_recurrence, episode_number)
  VALUES (_wo_id, now(), _user_id, _user_name, _reason, true, _new_episode);

  BEGIN
    INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
    VALUES (_wo_id, _user_id, _user_name, 'reopened_recurrence: ' || COALESCE(NULLIF(_reason,''), 'Same problem'));
  EXCEPTION WHEN foreign_key_violation OR unique_violation THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'wo_id', _wo_id,
    'wo_number', _orig.wo_number,
    'episode_number', _new_episode,
    'reopen_count', COALESCE(_orig.reopen_count, 0) + 1
  );
END;
$function$;

-- 4) Backfill: close orphan open episodes on WOs that already have reopen_count >= 1 but are still open from a previous reopen cycle that never propagated finished_at
UPDATE public.wo_episodes
   SET finished_at = now()
 WHERE finished_at IS NULL
   AND work_order_id IN (
     SELECT id FROM public.work_orders
      WHERE status::text IN ('finished', 'closed', 'completed', 'force_closed')
   );
