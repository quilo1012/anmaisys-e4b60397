-- A break is not a breakdown.
--
-- When a machine fails, the order marks the line stopped and the clock runs until
-- someone resumes it. But the line does not sit idle waiting: the team goes on their
-- break, fills the blender, brushes and cleans. That time was going to be lost
-- whatever the machine did — it is on the plan — and charging it to the maintenance
-- order makes a repair look worse the longer it happens to overlap lunch.
--
-- iTouching already knows which codes are planned; the catalogue carries the flag,
-- synced from their Admin Centre. Today that is: Breaks, Changeover, Brushing and
-- Cleaning, Deep Clean, Drill Cleaning, Filling Blender/Blending, Line Preparation,
-- Metal Detector Checks, No Planned Shift and Intouch Offline. This reads that flag
-- rather than hard-coding a list, so a code the factory reclassifies tomorrow needs
-- no migration.

/**
 * Minutes inside [_from, _to] that the line spent on a PLANNED stop.
 *
 * Overlap, not containment: a break that starts before the machine fails and ends
 * during the repair only contributes the part that overlaps.
 */
CREATE OR REPLACE FUNCTION public.planned_stop_minutes(_line text, _from timestamptz, _to timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(
    GREATEST(0, EXTRACT(EPOCH FROM (
      LEAST(d.ended_at, _to) - GREATEST(d.started_at, _from)
    )) / 60)
  ), 0)::numeric
  FROM public.production_downtimes d
  JOIN public.intouch_stop_code_catalog c
    ON lower(btrim(c.name)) = lower(btrim(d.reason))
  WHERE c.planned
    AND _line IS NOT NULL
    AND lower(btrim(d.line)) = lower(btrim(_line))
    AND d.started_at IS NOT NULL
    AND d.ended_at IS NOT NULL
    AND d.started_at < _to
    AND d.ended_at > _from;
$function$;

COMMENT ON FUNCTION public.planned_stop_minutes(text, timestamptz, timestamptz) IS
  'Minutes of PLANNED stoppage (per intouch_stop_code_catalog.planned) on a line inside a window. Used to keep breaks and cleaning off a maintenance order.';

/**
 * A work order's downtime, gross and net.
 *
 * Computed on read rather than written into a column: the planned windows arrive from
 * the iTouching poll minutes or hours after the fact, so a number frozen at the moment
 * the line resumed would be wrong for every order raised before its break was
 * reported. Read live, the figure corrects itself as the data lands.
 *
 * Covers both windows the screen already sums — the operator's declared stop and each
 * engineer-recorded event — so the gross stays exactly what it was and only the
 * planned deduction is new.
 *
 * LEAST(planned, gross) per window: a break reported as longer than the stop it sits
 * inside must not push the net below zero.
 */
CREATE OR REPLACE FUNCTION public.work_order_downtime(_wo_id uuid)
RETURNS TABLE (gross_minutes numeric, planned_minutes numeric, net_minutes numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  WITH w AS (SELECT * FROM public.work_orders WHERE id = _wo_id),
  windows AS (
    SELECT w.line_at_time AS line, w.line_stopped_at AS s, COALESCE(w.line_resumed_at, now()) AS e
    FROM w WHERE w.line_stopped_at IS NOT NULL
    UNION ALL
    SELECT w.line_at_time, d.stopped_at, COALESCE(d.resumed_at, now())
    FROM public.downtime_events d CROSS JOIN w WHERE d.work_order_id = _wo_id
  ),
  calc AS (
    SELECT EXTRACT(EPOCH FROM (e - s))/60 AS gross,
           public.planned_stop_minutes(line, s, e) AS planned
    FROM windows WHERE e > s
  )
  SELECT COALESCE(SUM(gross),0)::numeric,
         COALESCE(SUM(LEAST(planned, gross)),0)::numeric,
         GREATEST(0, COALESCE(SUM(gross),0) - COALESCE(SUM(LEAST(planned, gross)),0))::numeric
  FROM calc;
$function$;

-- SECURITY INVOKER: the caller must already be able to read the order. This adds a
-- number about a work order, not a way around who may see it.
REVOKE ALL ON FUNCTION public.work_order_downtime(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_order_downtime(uuid) TO authenticated;
