-- A planned job is not a breakdown.
--
-- The iTouching stop codes have carried `planned` since the catalogue was imported —
-- Changeover, Deep Clean, Line Preparation and the rest are stops, but they are not
-- downtime, and nobody is called out for them. Problem descriptions had no such flag,
-- so a maintenance job booked in advance counted against the line exactly like a
-- capper jam at two in the morning.
--
-- The list already shows what this is for: "Planned Full Shutdown Maintenance", and
-- the assembly and disassembly jobs — "Drill Motor Assembly" is WO-799, 284 minutes
-- against Line 3, which is the whole of that line's downtime for the day.
--
-- Nothing is marked planned here. Which jobs count is a decision about how the
-- factory measures itself, and setting it from a guess would rewrite history that
-- people have already reported on. The column arrives false and the screen is where
-- it gets set.

ALTER TABLE public.problem_descriptions
  ADD COLUMN IF NOT EXISTS planned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.problem_descriptions.planned IS
  'Planned work: the stop is real but does not count as downtime, mirroring intouch_stop_code_catalog.planned.';

-- Both views that report downtime honour it, so a planned job reads zero everywhere
-- rather than zero on one screen and full on another.

CREATE OR REPLACE VIEW public.v_wo_downtime_total AS
 SELECT de.work_order_id,
    count(*)::integer AS stop_count,
    CASE WHEN COALESCE(p.planned, false) THEN 0
         ELSE COALESCE(sum(COALESCE(de.duration_minutes,
                (EXTRACT(epoch FROM now() - de.stopped_at) / 60::numeric)::integer)), 0::bigint)::integer
    END AS total_minutes,
    bool_or(de.resumed_at IS NULL) AS has_open_stop
   FROM public.downtime_events de
   LEFT JOIN public.work_orders w ON w.id = de.work_order_id
   LEFT JOIN public.problem_descriptions p ON lower(p.name) = lower(w.description)
  GROUP BY de.work_order_id, p.planned;

-- `stop_count` deliberately still counts the stops. The line did stop, and hiding
-- that would make a shutdown look like a shift where nothing happened; it is the
-- minutes that do not count against the line.

CREATE OR REPLACE VIEW public.v_wo_metrics AS
 SELECT w.id, w.wo_number, w.machine, w.priority, w.status, w.line_stopped_at, w.created_at,
    w.received_at AS accepted_at, w.arrived_at, w.started_at, w.finished_at,
    w.line_resumed_at, w.closed_at,
    CASE WHEN EXISTS (
           SELECT 1 FROM public.problem_descriptions p
            WHERE lower(p.name) = lower(w.description) AND p.planned
         ) THEN 0
    ELSE COALESCE(
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
      EXTRACT(epoch FROM w.line_resumed_at - w.line_stopped_at)::integer
    ) END AS line_downtime_sec,
    EXTRACT(epoch FROM w.created_at - w.line_stopped_at)::integer AS reporting_delay_sec,
    EXTRACT(epoch FROM w.received_at - w.created_at)::integer AS response_time_sec,
    EXTRACT(epoch FROM w.started_at - w.received_at)::integer AS travel_time_sec,
    EXTRACT(epoch FROM w.finished_at - w.started_at)::integer - wo_total_pause_seconds(w.id) AS active_repair_sec,
    EXTRACT(epoch FROM w.line_resumed_at - w.finished_at)::integer AS restart_delay_sec,
    EXTRACT(epoch FROM w.closed_at - w.line_resumed_at)::integer AS paperwork_delay_sec,
    EXTRACT(epoch FROM w.closed_at - w.created_at)::integer AS total_cycle_sec
   FROM public.work_orders w;
