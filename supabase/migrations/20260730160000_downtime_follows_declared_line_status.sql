-- Downtime stops being assumed.
--
-- 1. Opening an order no longer stops the line by itself.
--
--    wo_auto_open_downtime set line_stopped := true on every new production order
--    that named a machine or a line, without ever reading NEW.line_stopped. The
--    create form asks "Line Status: Stopped / Running" and the client writes
--    line_stopped = false for Running — the trigger overwrote it a moment later.
--    So every order booked downtime from the second it was raised: orders where the
--    line kept running, orders raised for a job planned later, test orders.
--    Reported downtime could only ever be higher than the real thing.
--
--    The declared status is now respected. Paths that mean a genuine stop already
--    say so explicitly — the iTouching poller inserts line_stopped: true, and the
--    operator and line screens pass the operator's answer — so nothing that should
--    count stops counting.
--
-- 2. Force close asks whether the line was actually stopped.
--
--    Force close resumed the line at now(), which closed the open downtime event at
--    that instant: an order left open since the 29th booked twenty hours of parada
--    the moment someone tidied up the board. When the line never stopped, the honest
--    record is no downtime event at all, not a twenty-hour one.
--
--    Done in the database because discarding the event needs a DELETE on
--    downtime_events, which no role holds outside production_office_admin, and
--    because the status change and the downtime decision must not half-apply.

CREATE OR REPLACE FUNCTION public.wo_auto_open_downtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'open'
     AND NEW.line_stopped IS TRUE
     AND ( (NEW.machine IS NOT NULL AND NEW.machine <> '') OR NEW.line_id IS NOT NULL )
     AND NEW.line_stopped_at IS NULL THEN
    NEW.line_stopped_at := COALESCE(NEW.line_stopped_at, NEW.created_at, now());
    NEW.line_stopped_by := COALESCE(NEW.line_stopped_by, NEW.operator_id);
  END IF;
  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION public.wo_auto_open_downtime() IS
  'Stamps the stoppage start only when the order says the line is stopped. Never sets line_stopped itself — that is the requester''s answer, not an assumption.';

CREATE OR REPLACE FUNCTION public.force_close_work_order(
  _wo_id uuid,
  _line_was_stopped boolean,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _wo record;
  _discarded_min numeric := 0;
  _discarded_rows integer := 0;
BEGIN
  IF NOT (has_role(_uid, 'admin') OR has_role(_uid, 'manager') OR has_role(_uid, 'maintenance_manager')) THEN
    RAISE EXCEPTION 'You do not have permission to force close a maintenance order.';
  END IF;

  SELECT * INTO _wo FROM public.work_orders WHERE id = _wo_id;
  IF _wo.id IS NULL THEN
    RAISE EXCEPTION 'Maintenance order not found.';
  END IF;

  IF _line_was_stopped THEN
    -- The stoppage was real: close it now, exactly as before.
    UPDATE public.work_orders
    SET status = 'force_closed',
        closed_by = _uid,
        completed_at = now(),
        finished_at = now(),
        notes = CASE WHEN _note IS NULL OR btrim(_note) = '' THEN notes
                     ELSE COALESCE(notes || E'\n', '') || _note END,
        line_stopped = CASE WHEN line_stopped AND line_resumed_at IS NULL THEN false ELSE line_stopped END,
        line_resumed_at = CASE WHEN line_stopped AND line_resumed_at IS NULL THEN now() ELSE line_resumed_at END,
        line_resumed_by = CASE WHEN line_stopped AND line_resumed_at IS NULL THEN _uid ELSE line_resumed_by END
    WHERE id = _wo_id;
  ELSE
    -- The line kept running. Drop the open stoppage instead of closing it, and
    -- clear the WO's own stop stamps so the auto-close trigger cannot reopen the
    -- question later.
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (now() - stopped_at)) / 60), 0), COUNT(*)
    INTO _discarded_min, _discarded_rows
    FROM public.downtime_events
    WHERE work_order_id = _wo_id AND resumed_at IS NULL;

    DELETE FROM public.downtime_events
    WHERE work_order_id = _wo_id AND resumed_at IS NULL;

    UPDATE public.work_orders
    SET status = 'force_closed',
        closed_by = _uid,
        completed_at = now(),
        finished_at = now(),
        notes = CASE WHEN _note IS NULL OR btrim(_note) = '' THEN notes
                     ELSE COALESCE(notes || E'\n', '') || _note END,
        line_stopped = false,
        line_stopped_at = NULL,
        line_resumed_at = NULL,
        line_resumed_by = NULL
    WHERE id = _wo_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    _uid,
    COALESCE((SELECT name FROM public.profiles WHERE id = _uid), 'Unknown'),
    'force_close',
    'work_order',
    _wo_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('status', _wo.status, 'line_stopped', _wo.line_stopped, 'line_stopped_at', _wo.line_stopped_at),
      'after', jsonb_build_object('status', 'force_closed'),
      'line_was_stopped', _line_was_stopped,
      'downtime_events_discarded', _discarded_rows,
      'downtime_minutes_discarded', round(_discarded_min, 1),
      'note', _note
    )
  );

  RETURN jsonb_build_object(
    'wo_number', _wo.wo_number,
    'line_was_stopped', _line_was_stopped,
    'downtime_events_discarded', _discarded_rows,
    'downtime_minutes_discarded', round(_discarded_min, 1)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.force_close_work_order(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.force_close_work_order(uuid, boolean, text) TO authenticated;
