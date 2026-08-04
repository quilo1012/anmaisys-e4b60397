-- Line downtime measured from the stops, not from two columns nobody fills in.
--
-- `line_downtime_sec` was `line_resumed_at - line_stopped_at` off the order row.
-- Those two columns are set on 51 of 365 orders. The stop is normally recorded as a
-- `downtime_events` row instead — 276 orders have one — so the subtraction returned
-- NULL for the great majority.
--
-- Nothing was averaging over those nulls: the Manager dashboard skips them. That is
-- the problem. Avg Line Downtime was the honest average of an arbitrary seventh of
-- the orders, and the six sevenths it silently dropped were the ones with real event
-- data. The WO timeline had already worked around this in the UI, and its comment
-- says why; this moves the fix under it so every reader gets the same number.
--
-- Counted the way the timeline footer counts it:
--   * the stops themselves, summed — a line that stops twice is two stoppages, not
--     one span measured end to end across the running minutes in the middle;
--   * minus any overlap with a downtime exclusion, because a team activity is not
--     downtime and every pause row on the timeline says so;
--   * an unresumed stop runs to now(), so a live stoppage shows live impact.
-- The old subtraction stays as the fallback for orders that have no event at all.

CREATE OR REPLACE VIEW public.v_wo_metrics AS
 SELECT id,
    wo_number,
    machine,
    priority,
    status,
    line_stopped_at,
    created_at,
    received_at AS accepted_at,
    arrived_at,
    started_at,
    finished_at,
    line_resumed_at,
    closed_at,
    COALESCE(
      -- `count(*) = 0 THEN NULL` is load-bearing. An aggregate over no rows returns
      -- NULL, but GREATEST(0, NULL) is 0 in Postgres, so without this an order with
      -- no stoppage at all read as zero downtime instead of no measurement — and the
      -- COALESCE below could never reach the fallback. It put a number on all 365
      -- orders, which is how it was caught.
      (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE GREATEST(0, (
                SUM(EXTRACT(epoch FROM COALESCE(e.resumed_at, now()) - e.stopped_at))
                - COALESCE((
                    SELECT SUM(GREATEST(0, EXTRACT(epoch FROM
                             LEAST(COALESCE(e2.resumed_at, now()), x.ended_at)
                           - GREATEST(e2.stopped_at, x.started_at))))
                    FROM public.downtime_events e2
                    JOIN public.wo_downtime_exclusions x ON x.work_order_id = e2.work_order_id
                    WHERE e2.work_order_id = w.id
                      AND x.ended_at IS NOT NULL
                      AND x.started_at < COALESCE(e2.resumed_at, now())
                      AND x.ended_at > e2.stopped_at
                  ), 0)
              ))::integer END
       FROM public.downtime_events e
       WHERE e.work_order_id = w.id),
      EXTRACT(epoch FROM line_resumed_at - line_stopped_at)::integer
    ) AS line_downtime_sec,
    EXTRACT(epoch FROM created_at - line_stopped_at)::integer AS reporting_delay_sec,
    EXTRACT(epoch FROM received_at - created_at)::integer AS response_time_sec,
    EXTRACT(epoch FROM started_at - received_at)::integer AS travel_time_sec,
    EXTRACT(epoch FROM finished_at - started_at)::integer - wo_total_pause_seconds(id) AS active_repair_sec,
    EXTRACT(epoch FROM line_resumed_at - finished_at)::integer AS restart_delay_sec,
    EXTRACT(epoch FROM closed_at - line_resumed_at)::integer AS paperwork_delay_sec,
    EXTRACT(epoch FROM closed_at - created_at)::integer AS total_cycle_sec
   FROM public.work_orders w;
