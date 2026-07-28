-- Root Diagnostics: capture app errors (React crashes, JS errors, rejected
-- promises, logged RLS/API failures) so an admin can diagnose "the audio didn't
-- send" / "the tablet logged out" after the fact — no external service (Sentry).
-- Any authenticated user logs their OWN error; only admins can read/clear.
-- Applied live; kept for the record.
CREATE TABLE IF NOT EXISTS public.system_telemetry_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  user_role text,
  error_type text NOT NULL,
  message text NOT NULL,
  stack_trace text,
  route_path text,
  metadata jsonb
);
CREATE INDEX IF NOT EXISTS system_telemetry_logs_created_idx ON public.system_telemetry_logs (created_at DESC);

ALTER TABLE public.system_telemetry_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "telemetry insert own" ON public.system_telemetry_logs;
CREATE POLICY "telemetry insert own" ON public.system_telemetry_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "telemetry admin read" ON public.system_telemetry_logs;
CREATE POLICY "telemetry admin read" ON public.system_telemetry_logs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "telemetry admin delete" ON public.system_telemetry_logs;
CREATE POLICY "telemetry admin delete" ON public.system_telemetry_logs
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.system_telemetry_logs FROM anon;
GRANT INSERT, SELECT, DELETE ON public.system_telemetry_logs TO authenticated;
