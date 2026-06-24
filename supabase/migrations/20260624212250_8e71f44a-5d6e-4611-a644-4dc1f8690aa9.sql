
CREATE TABLE public.teams_webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  title text,
  success boolean NOT NULL,
  status_code int,
  attempts int NOT NULL DEFAULT 1,
  error_message text,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX teams_webhook_logs_created_at_idx
  ON public.teams_webhook_logs (created_at DESC);

GRANT SELECT ON public.teams_webhook_logs TO authenticated;
GRANT ALL ON public.teams_webhook_logs TO service_role;

ALTER TABLE public.teams_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/manager can read teams webhook logs"
  ON public.teams_webhook_logs
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
  );
