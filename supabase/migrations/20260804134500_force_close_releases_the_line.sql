-- Force-closing an order releases the line it was holding.
--
-- `force_close_work_order` decided whether to release the line from the boolean
-- `line_stopped`:
--
--   line_resumed_at = CASE WHEN line_stopped AND line_resumed_at IS NULL THEN now() ...
--
-- Every screen that reports a stoppage reads the timestamps instead —
-- `line_stopped_at IS NOT NULL AND line_resumed_at IS NULL` — and on orders raised by
-- the iTouching poll the two disagree: the timestamp is set and the boolean is false.
-- So the branch never fired, the line was never released, and the order sat closed
-- while the board went on counting it as stopped.
--
-- WO-633 (Line 2, 31/07), WO-634 (Line 4, 31/07) and WO-636 (Line 1, 02/08) were all
-- in that state — force-closed days ago, still reported LIVE, three lines showing
-- 7h13m of downtime that was the clock since 06:00 this morning and nothing else.
--
-- The condition now matches what the readers read. `closed_at` is stamped too: the
-- function set `completed_at` and `finished_at` and left `closed_at` null, which is
-- why the stuck orders had no closing time at all.

CREATE OR REPLACE FUNCTION public.force_close_work_order(_wo_id uuid, _line_was_stopped boolean, _note text DEFAULT NULL::text)
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
  IF NOT (has_role(_uid, 'admin') OR has_role(_uid, 'maintenance_manager')) THEN
    RAISE EXCEPTION 'Only the maintenance manager or an admin can force close a maintenance order.';
  END IF;

  SELECT * INTO _wo FROM public.work_orders WHERE id = _wo_id;
  IF _wo.id IS NULL THEN RAISE EXCEPTION 'Maintenance order not found.'; END IF;

  IF _line_was_stopped THEN
    UPDATE public.work_orders
    SET status = 'force_closed', closed_by = _uid, completed_at = now(), finished_at = now(),
        closed_at = COALESCE(closed_at, now()),
        notes = CASE WHEN _note IS NULL OR btrim(_note)='' THEN notes ELSE COALESCE(notes || E'\n','') || _note END,
        line_stopped = false,
        -- Keyed on the timestamps, which is what every reader uses. The boolean is
        -- false on iTouching-raised orders even while the stop is open, and trusting
        -- it left the line held for ever.
        line_resumed_at = CASE WHEN line_stopped_at IS NOT NULL AND line_resumed_at IS NULL THEN now() ELSE line_resumed_at END,
        line_resumed_by = CASE WHEN line_stopped_at IS NOT NULL AND line_resumed_at IS NULL THEN _uid ELSE line_resumed_by END
    WHERE id = _wo_id;
  ELSE
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (now() - stopped_at))/60),0), COUNT(*)
      INTO _discarded_min, _discarded_rows
    FROM public.downtime_events WHERE work_order_id = _wo_id AND resumed_at IS NULL;

    DELETE FROM public.downtime_events WHERE work_order_id = _wo_id AND resumed_at IS NULL;

    UPDATE public.work_orders
    SET status = 'force_closed', closed_by = _uid, completed_at = now(), finished_at = now(),
        closed_at = COALESCE(closed_at, now()),
        notes = CASE WHEN _note IS NULL OR btrim(_note)='' THEN notes ELSE COALESCE(notes || E'\n','') || _note END,
        line_stopped = false, line_stopped_at = NULL, line_resumed_at = NULL, line_resumed_by = NULL
    WHERE id = _wo_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (_uid, COALESCE((SELECT name FROM public.profiles WHERE id=_uid),'Unknown'),
    'force_close','work_order',_wo_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('status',_wo.status,'line_stopped',_wo.line_stopped,'line_stopped_at',_wo.line_stopped_at),
      'after', jsonb_build_object('status','force_closed'),
      'line_was_stopped', _line_was_stopped,
      'downtime_events_discarded', _discarded_rows,
      'downtime_minutes_discarded', round(_discarded_min,1),
      'note', _note));

  RETURN jsonb_build_object('wo_number',_wo.wo_number,'line_was_stopped',_line_was_stopped,
    'downtime_events_discarded',_discarded_rows,'downtime_minutes_discarded',round(_discarded_min,1));
END $function$;

-- The orders already stranded by this. Released at the handover that ended the shift
-- they stopped in, not at now(), so today is not charged with days of phantom
-- downtime that never happened.
WITH boundary AS (
  SELECT id,
         ((CASE
            WHEN EXTRACT(HOUR FROM (line_stopped_at AT TIME ZONE 'Europe/London')) < 6
              THEN date_trunc('day', line_stopped_at AT TIME ZONE 'Europe/London') + interval '6 hours'
            WHEN EXTRACT(HOUR FROM (line_stopped_at AT TIME ZONE 'Europe/London')) < 18
              THEN date_trunc('day', line_stopped_at AT TIME ZONE 'Europe/London') + interval '18 hours'
            ELSE date_trunc('day', line_stopped_at AT TIME ZONE 'Europe/London') + interval '1 day 6 hours'
          END) AT TIME ZONE 'Europe/London') AS ends_at
  FROM public.work_orders
  WHERE line_stopped_at IS NOT NULL AND line_resumed_at IS NULL
)
UPDATE public.work_orders w
   SET line_resumed_at = b.ends_at,
       line_stopped = false,
       closed_at = COALESCE(w.closed_at, b.ends_at),
       notes = COALESCE(w.notes,'') || E'\n[line released at end of shift - force close had left it held]'
  FROM boundary b
 WHERE w.id = b.id AND b.ends_at < now();
