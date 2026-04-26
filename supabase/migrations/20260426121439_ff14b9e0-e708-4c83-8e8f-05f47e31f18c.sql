DROP POLICY IF EXISTS "Scoped downtime_events select" ON public.downtime_events;
DROP POLICY IF EXISTS dt_insert ON public.downtime_events;
DROP POLICY IF EXISTS dt_update ON public.downtime_events;

CREATE POLICY "Scoped downtime_events select"
ON public.downtime_events
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'manager'::public.app_role)
  OR public.has_role(auth.uid(), 'engineer'::public.app_role)
  OR stopped_by = auth.uid()
  OR resumed_by = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.work_orders wo
    WHERE wo.id = downtime_events.work_order_id
      AND (
        wo.operator_id = auth.uid()
        OR (
          public.has_role(auth.uid(), 'operator'::public.app_role)
          AND EXISTS (
            SELECT 1
            FROM public.operator_line_accounts ola
            WHERE ola.user_id = auth.uid()
              AND wo.line_id = ANY(ola.line_ids)
          )
        )
      )
  )
);

CREATE POLICY dt_insert
ON public.downtime_events
FOR INSERT
TO authenticated
WITH CHECK (
  stopped_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'engineer'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'operator'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.work_orders wo
        WHERE wo.id = downtime_events.work_order_id
          AND (
            wo.operator_id = auth.uid()
            OR EXISTS (
              SELECT 1
              FROM public.operator_line_accounts ola
              WHERE ola.user_id = auth.uid()
                AND wo.line_id = ANY(ola.line_ids)
            )
          )
      )
    )
  )
);

CREATE POLICY dt_update
ON public.downtime_events
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'manager'::public.app_role)
  OR public.has_role(auth.uid(), 'engineer'::public.app_role)
  OR stopped_by = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.work_orders wo
    WHERE wo.id = downtime_events.work_order_id
      AND (
        wo.operator_id = auth.uid()
        OR (
          public.has_role(auth.uid(), 'operator'::public.app_role)
          AND EXISTS (
            SELECT 1
            FROM public.operator_line_accounts ola
            WHERE ola.user_id = auth.uid()
              AND wo.line_id = ANY(ola.line_ids)
          )
        )
      )
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'manager'::public.app_role)
  OR public.has_role(auth.uid(), 'engineer'::public.app_role)
  OR stopped_by = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.work_orders wo
    WHERE wo.id = downtime_events.work_order_id
      AND (
        wo.operator_id = auth.uid()
        OR (
          public.has_role(auth.uid(), 'operator'::public.app_role)
          AND EXISTS (
            SELECT 1
            FROM public.operator_line_accounts ola
            WHERE ola.user_id = auth.uid()
              AND wo.line_id = ANY(ola.line_ids)
          )
        )
      )
  )
);

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

  UPDATE public.wo_episodes
    SET finished_at = COALESCE(finished_at, now())
    WHERE work_order_id = _wo_id AND episode_number = _orig.current_episode;

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