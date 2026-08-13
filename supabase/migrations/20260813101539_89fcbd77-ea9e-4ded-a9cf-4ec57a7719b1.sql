CREATE OR REPLACE VIEW public.v_wo_metrics
WITH (security_invoker = true) AS
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
        CASE
            WHEN (EXISTS ( SELECT 1
               FROM problem_descriptions p
              WHERE lower(p.name) = lower(w.description) AND p.planned)) THEN 0
            ELSE COALESCE(public.wo_downtime_seconds(w.id), EXTRACT(epoch FROM line_resumed_at - line_stopped_at)::integer)
        END AS line_downtime_sec,
    EXTRACT(epoch FROM created_at - line_stopped_at)::integer AS reporting_delay_sec,
    EXTRACT(epoch FROM received_at - created_at)::integer AS response_time_sec,
    EXTRACT(epoch FROM started_at - received_at)::integer AS travel_time_sec,
    EXTRACT(epoch FROM finished_at - started_at)::integer - wo_total_pause_seconds(id) AS active_repair_sec,
    EXTRACT(epoch FROM line_resumed_at - finished_at)::integer AS restart_delay_sec,
    EXTRACT(epoch FROM closed_at - line_resumed_at)::integer AS paperwork_delay_sec,
    EXTRACT(epoch FROM closed_at - created_at)::integer AS total_cycle_sec
   FROM work_orders w;