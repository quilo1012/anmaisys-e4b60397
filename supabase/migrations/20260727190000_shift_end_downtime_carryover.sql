-- Shift-end downtime handling: when an engineer doesn't finish a line-stopping
-- work order before the shift ends, close that shift's downtime at the boundary
-- AND, if the work order is still active, open a fresh downtime episode for the
-- new shift on the SAME work order (which stays open until it's finished). So
-- each shift is charged only its own downtime, and nothing bleeds across shifts
-- as one giant open event.
--
-- Replaces the old per-shift "resume all open events / resume all WOs" crons.
-- Applied live via cron.alter_job / cron.schedule / cron.unschedule; kept here
-- for the record.

CREATE OR REPLACE FUNCTION public.close_shift_downtime()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _now timestamptz := now(); _h int;
BEGIN
  -- Act exactly at a London shift boundary (Day ends 18:00, Night ends 06:00).
  -- Cron fires at both the BST and GMT UTC-times; this guard runs it once.
  _h := EXTRACT(HOUR FROM (_now AT TIME ZONE 'Europe/London'))::int;
  IF _h NOT IN (6, 18) THEN RETURN; END IF;

  -- Carry over: new episode for the new shift on still-open events whose WO is
  -- still ACTIVE (positive status filter, so a terminal/unknown status never
  -- keeps accruing downtime forever).
  INSERT INTO public.downtime_events
    (work_order_id, stopped_at, stopped_by, stopped_by_name, stopped_reason, episode_number)
  SELECT de.work_order_id, _now, de.stopped_by, de.stopped_by_name, de.stopped_reason, de.episode_number + 1
  FROM public.downtime_events de
  JOIN public.work_orders wo ON wo.id = de.work_order_id
  WHERE de.resumed_at IS NULL AND de.stopped_at < _now
    AND wo.status IN ('open','in_progress');

  -- Close every event still open from the ending shift at the boundary.
  UPDATE public.downtime_events
     SET resumed_at = _now,
         resumed_note = COALESCE(resumed_note,'') || ' [auto-closed: end of shift]'
   WHERE resumed_at IS NULL AND stopped_at < _now;
END; $function$;

-- Cron wiring (applied live):
--   close-day-shift-downtime      0 17 * * *  → SELECT public.close_shift_downtime();
--   close-night-shift-downtime    0 5  * * *  → SELECT public.close_shift_downtime();
--   close-shift-downtime-1800utc  0 18 * * *  → SELECT public.close_shift_downtime();
--   close-shift-downtime-0600utc  0 6  * * *  → SELECT public.close_shift_downtime();
-- (The 17/05 and 18/06 UTC pairs cover BST and GMT; the in-function guard makes
--  it fire once per real London boundary.)
-- Removed: close-day-shift-work-orders and close-night-shift-work-orders (they
-- force-resumed WOs at shift end, which conflicts with the carry-over model).
