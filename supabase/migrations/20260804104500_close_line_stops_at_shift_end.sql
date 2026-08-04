-- A stoppage belongs to the shift that raised it, and dies with it.
--
-- Two faults, both visible on 04/08 as 10h10m of downtime on a day where nothing was
-- raised:
--
-- 1. `close_shift_downtime()` only ever closed `downtime_events`. The dashboard reads
--    three sources, and the third — a work order holding `line_stopped_at` with no
--    `line_resumed_at` — was outside its reach. WO 703 stopped Line 4 at 15:40 on
--    03/08 and was still accruing nineteen hours later; WO 799 held Line 3 from 01:16.
--    Nothing would ever have stopped either clock.
--
-- 2. It carried the stoppage over: a still-open event got a fresh episode on the new
--    shift, so a line stopped on Monday stayed stopped, on paper, into Tuesday. The
--    factory's rule is the opposite — the order closes at the handover whether or not
--    an engineer ever accepted it, and if the problem is still there the incoming
--    shift raises its own. That way each shift owns what it reports, and a fault that
--    survives three handovers reads as three orders, which is the truth of it.
--
-- Scope is deliberately narrow: only orders that were holding a line stopped. Closing
-- every open order at the handover would sweep up planned work and warehouse jobs that
-- have nothing to do with downtime.
--
-- `force_closed` is the existing status for an order that ended without an engineer
-- finishing it, and the app already treats it as terminal and keeps it out of the
-- response and MTTR averages — so an automatic close cannot flatter those numbers.

CREATE OR REPLACE FUNCTION public.close_shift_downtime()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _now timestamptz := now(); _h int; _events int; _lines int;
BEGIN
  _h := EXTRACT(HOUR FROM (_now AT TIME ZONE 'Europe/London'))::int;
  IF _h NOT IN (6, 18) THEN RETURN; END IF;

  -- Close every event still open from the ending shift. No carry-over: the incoming
  -- shift raises its own order if the line is still down.
  UPDATE public.downtime_events
     SET resumed_at = _now,
         resumed_note = COALESCE(resumed_note,'') || ' [auto-closed: end of shift]'
   WHERE resumed_at IS NULL AND stopped_at < _now;
  GET DIAGNOSTICS _events = ROW_COUNT;

  -- Release the line itself, then close the order that was holding it. Both halves
  -- matter: releasing without closing leaves an order nobody owns, and closing
  -- without releasing leaves the line reading as stopped forever.
  UPDATE public.work_orders
     SET line_resumed_at = _now,
         status = CASE WHEN status IN ('open','in_progress','received','arrived')
                       THEN 'force_closed'::wo_status ELSE status END,
         closed_at = COALESCE(closed_at, _now),
         notes = COALESCE(notes,'') ||
                 E'\n[auto-closed at end of shift — raise a new order if the line is still down]'
   WHERE line_stopped_at IS NOT NULL
     AND line_resumed_at IS NULL
     AND line_stopped_at < _now;
  GET DIAGNOSTICS _lines = ROW_COUNT;

  RAISE NOTICE 'close_shift_downtime: % events, % line stops', _events, _lines;
END; $function$;

-- Backfill: close what the old function could never reach, at the handover it should
-- have died at rather than at now(), so today's dashboard is not credited with
-- yesterday's hours.
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
       status = CASE WHEN w.status IN ('open','in_progress','received','arrived')
                     THEN 'force_closed'::wo_status ELSE w.status END,
       closed_at = COALESCE(w.closed_at, b.ends_at),
       notes = COALESCE(w.notes,'') ||
               E'\n[auto-closed at end of shift — backfilled 04/08/2026]'
  FROM boundary b
 WHERE w.id = b.id AND b.ends_at < now();

-- The same two stoppages have an event row each. They close at the same handover, not
-- at a made-up duration: the shift they were raised in is the only defensible end.
UPDATE public.downtime_events
   SET resumed_at = ((CASE
          WHEN EXTRACT(HOUR FROM (stopped_at AT TIME ZONE 'Europe/London')) < 6
            THEN date_trunc('day', stopped_at AT TIME ZONE 'Europe/London') + interval '6 hours'
          WHEN EXTRACT(HOUR FROM (stopped_at AT TIME ZONE 'Europe/London')) < 18
            THEN date_trunc('day', stopped_at AT TIME ZONE 'Europe/London') + interval '18 hours'
          ELSE date_trunc('day', stopped_at AT TIME ZONE 'Europe/London') + interval '1 day 6 hours'
        END) AT TIME ZONE 'Europe/London'),
       resumed_note = COALESCE(resumed_note,'') || ' [auto-closed: backfilled 04/08/2026]'
 WHERE resumed_at IS NULL;
