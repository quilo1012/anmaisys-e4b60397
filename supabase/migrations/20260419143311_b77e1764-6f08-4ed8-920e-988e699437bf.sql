-- Pause tracking table for accurate Active Repair Time
CREATE TABLE IF NOT EXISTS public.wo_pauses (
  id uuid primary key default gen_random_uuid(),
  wo_id uuid references public.work_orders(id) on delete cascade,
  paused_at timestamptz not null,
  resumed_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);

ALTER TABLE public.wo_pauses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wo_pauses_select_auth" ON public.wo_pauses;
CREATE POLICY "wo_pauses_select_auth" ON public.wo_pauses
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "wo_pauses_insert_roles" ON public.wo_pauses;
CREATE POLICY "wo_pauses_insert_roles" ON public.wo_pauses
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'engineer'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'manager'::app_role)
  );

DROP POLICY IF EXISTS "wo_pauses_update_roles" ON public.wo_pauses;
CREATE POLICY "wo_pauses_update_roles" ON public.wo_pauses
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'engineer'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'manager'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_wo_pauses_wo_id ON public.wo_pauses(wo_id);

-- Helper: total pause seconds for a WO (excludes pause time from active repair)
CREATE OR REPLACE FUNCTION public.wo_total_pause_seconds(_wo_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    SUM(EXTRACT(EPOCH FROM (COALESCE(resumed_at, now()) - paused_at))),
    0
  )::int
  FROM public.wo_pauses WHERE wo_id = _wo_id;
$$;

-- Single source of truth for all WO duration metrics
CREATE OR REPLACE VIEW public.v_wo_metrics AS
SELECT
  wo.id,
  wo.wo_number,
  wo.machine,
  wo.priority,
  wo.status,

  -- Raw timestamps (received_at aliased as accepted_at for semantic clarity)
  wo.line_stopped_at,
  wo.created_at,
  wo.received_at        AS accepted_at,
  wo.arrived_at,
  wo.started_at,
  wo.finished_at,
  wo.line_resumed_at,
  wo.closed_at,

  -- Durations in seconds (NULL when timestamps are missing)
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