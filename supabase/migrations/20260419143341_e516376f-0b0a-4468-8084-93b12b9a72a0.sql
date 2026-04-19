DROP VIEW IF EXISTS public.v_wo_metrics;

CREATE VIEW public.v_wo_metrics
WITH (security_invoker = on) AS
SELECT
  wo.id,
  wo.wo_number,
  wo.machine,
  wo.priority,
  wo.status,
  wo.line_stopped_at,
  wo.created_at,
  wo.received_at        AS accepted_at,
  wo.arrived_at,
  wo.started_at,
  wo.finished_at,
  wo.line_resumed_at,
  wo.closed_at,
  EXTRACT(EPOCH FROM (wo.line_resumed_at - wo.line_stopped_at))::int AS line_downtime_sec,
  EXTRACT(EPOCH FROM (wo.created_at      - wo.line_stopped_at))::int AS reporting_delay_sec,
  EXTRACT(EPOCH FROM (wo.received_at     - wo.created_at))::int      AS response_time_sec,
  EXTRACT(EPOCH FROM (wo.started_at      - wo.received_at))::int     AS travel_time_sec,
  (EXTRACT(EPOCH FROM (wo.finished_at - wo.started_at))::int
   - public.wo_total_pause_seconds(wo.id))                            AS active_repair_sec,
  EXTRACT(EPOCH FROM (wo.line_resumed_at - wo.finished_at))::int     AS restart_delay_sec,
  EXTRACT(EPOCH FROM (wo.closed_at       - wo.line_resumed_at))::int AS paperwork_delay_sec,
  EXTRACT(EPOCH FROM (wo.closed_at       - wo.created_at))::int      AS total_cycle_sec
FROM public.work_orders wo;

GRANT SELECT ON public.v_wo_metrics TO authenticated;