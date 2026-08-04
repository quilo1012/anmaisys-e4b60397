-- A stoppage order dies with its shift even after the line is back.
--
-- The previous version only closed orders that were STILL holding a line. That is
-- narrower than the rule, and narrower than what I claimed it did: the factory's rule
-- is that the order closes at the handover whether or not an engineer accepted it,
-- and it says nothing about whether somebody has restarted the line in the meantime.
--
-- So an order whose line came back kept running: WO-803 (Line 4, stopped 16:44,
-- released 17:01 on 04/08) sat open through the 18:00 handover, and WO-699 (Capsules
-- Machine 1, 03/08) sat open through two.
--
-- Still scoped to orders that came from a line stop. Planned maintenance and
-- warehouse jobs have no `line_stopped_at` and are not touched — closing every open
-- order at a handover would sweep those up, which is what the narrow version was
-- protecting against and is still worth protecting.

CREATE OR REPLACE FUNCTION public.close_shift_downtime()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _now timestamptz := now(); _h int; _events int; _held int; _stale int;
BEGIN
  _h := EXTRACT(HOUR FROM (_now AT TIME ZONE 'Europe/London'))::int;
  IF _h NOT IN (6, 18) THEN RETURN; END IF;

  UPDATE public.downtime_events
     SET resumed_at = _now,
         resumed_note = COALESCE(resumed_note,'') || ' [auto-closed: end of shift]'
   WHERE resumed_at IS NULL AND stopped_at < _now;
  GET DIAGNOSTICS _events = ROW_COUNT;

  -- Still holding a line: release it and close the order.
  UPDATE public.work_orders
     SET line_resumed_at = _now,
         status = CASE WHEN status IN ('open','in_progress','received','arrived')
                       THEN 'force_closed'::wo_status ELSE status END,
         closed_at = COALESCE(closed_at, _now),
         line_stopped = false,
         notes = COALESCE(notes,'') ||
                 E'\n[auto-closed at end of shift - raise a new order if the line is still down]'
   WHERE line_stopped_at IS NOT NULL AND line_resumed_at IS NULL AND line_stopped_at < _now;
  GET DIAGNOSTICS _held = ROW_COUNT;

  -- The line is already back, but the order is still open from an earlier shift.
  UPDATE public.work_orders
     SET status = 'force_closed'::wo_status,
         closed_at = COALESCE(closed_at, _now),
         notes = COALESCE(notes,'') ||
                 E'\n[auto-closed at end of shift - the line was already back; raise a new order if the fault remains]'
   WHERE status IN ('open','in_progress','received','arrived')
     AND line_stopped_at IS NOT NULL
     AND line_stopped_at < date_trunc('hour', _now);
  GET DIAGNOSTICS _stale = ROW_COUNT;

  RAISE NOTICE 'close_shift_downtime: % events, % held, % stale', _events, _held, _stale;
END; $function$;
