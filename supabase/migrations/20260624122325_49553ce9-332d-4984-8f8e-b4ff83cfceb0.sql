
-- 1) Column-level lockdown: labor_rate (admins use list_profile_labor_rates / get_profile_labor_rate RPCs)
REVOKE SELECT (labor_rate) ON public.profiles FROM authenticated, anon;
GRANT SELECT (labor_rate) ON public.profiles TO service_role;

-- 2) Column-level lockdown: device_token (managers/admins use admin_list_device_tokens RPC)
REVOKE SELECT (device_token) ON public.devices FROM authenticated, anon;
GRANT SELECT (device_token) ON public.devices TO service_role;

-- 3) pin_attempts: allow admin SELECT for diagnostics; service role retains full access
CREATE POLICY "Admins can view pin lockout state"
  ON public.pin_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 4) Performance indexes for the hottest queries identified by pg_stat_statements
CREATE INDEX IF NOT EXISTS idx_wo_line_created
  ON public.work_orders (line_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wo_status_created
  ON public.work_orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wo_line_stopped_open
  ON public.work_orders (line_stopped, line_resumed_at)
  WHERE line_stopped = true AND line_resumed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_problem_descriptions_active_name
  ON public.problem_descriptions (active, name);

CREATE INDEX IF NOT EXISTS idx_machines_name
  ON public.machines (name);
