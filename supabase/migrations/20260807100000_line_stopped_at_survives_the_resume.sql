-- A hora de paragem deixava de existir quando a linha voltava.
--
-- `sync_wo_line_status` is an AFTER trigger on `downtime_events` that recomputes the
-- order's line columns from its events. It asked for the newest event WHERE
-- `resumed_at IS NULL` — the stop that is still open — and wrote the answer into
-- `line_stopped_at`.
--
-- So the moment a stoppage was closed, that subquery found nothing and wrote NULL over
-- the start time. "Is the line down" and "when did it go down" are different questions
-- and only the first stops being true when the line comes back.
--
-- Seven orders lost theirs: 802, 806, 807, 809, 814, 816 and 817 — the last of them
-- this morning, so it was still happening. Both resume paths hit it, the engineer's
-- own button and the end-of-shift job, which is what put the fault downstream of both
-- rather than in either.
--
-- The newest event, resumed or not, answers both readings: the current stop while one
-- is open, and the last one once it is over.
CREATE OR REPLACE FUNCTION public.sync_wo_line_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _wo_id uuid := COALESCE(NEW.work_order_id, OLD.work_order_id);
BEGIN
  UPDATE public.work_orders wo SET
    line_stopped = EXISTS (
      SELECT 1 FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NULL
    ),
    line_stopped_at = (
      SELECT stopped_at FROM public.downtime_events
      WHERE work_order_id = wo.id
      ORDER BY stopped_at DESC LIMIT 1
    ),
    line_stopped_by = (
      SELECT stopped_by FROM public.downtime_events
      WHERE work_order_id = wo.id
      ORDER BY stopped_at DESC LIMIT 1
    ),
    line_resumed_at = (
      SELECT resumed_at FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NOT NULL
      ORDER BY resumed_at DESC LIMIT 1
    ),
    line_resumed_by = (
      SELECT resumed_by FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NOT NULL
      ORDER BY resumed_at DESC LIMIT 1
    )
  WHERE wo.id = _wo_id;
  RETURN NULL;
END $fn$;

-- Nothing was lost: the event kept the hour the order threw away.
UPDATE public.work_orders w
SET line_stopped_at = e.stopped_at,
    line_stopped_by = COALESCE(w.line_stopped_by, e.stopped_by)
FROM (
  SELECT DISTINCT ON (work_order_id) work_order_id, stopped_at, stopped_by
  FROM public.downtime_events ORDER BY work_order_id, stopped_at DESC
) e
WHERE e.work_order_id = w.id AND w.line_stopped_at IS NULL;
