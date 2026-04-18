DROP VIEW IF EXISTS public.v_wo_downtime_total;

CREATE VIEW public.v_wo_downtime_total
WITH (security_invoker = true) AS
SELECT
  work_order_id,
  COUNT(*)::int AS stop_count,
  COALESCE(SUM(
    COALESCE(duration_minutes, (EXTRACT(EPOCH FROM (now() - stopped_at))/60)::int)
  ), 0)::int AS total_minutes,
  bool_or(resumed_at IS NULL) AS has_open_stop
FROM public.downtime_events
GROUP BY work_order_id;