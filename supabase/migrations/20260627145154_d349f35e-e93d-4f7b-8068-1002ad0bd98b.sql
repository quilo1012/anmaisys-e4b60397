
CREATE TABLE IF NOT EXISTS public.intouch_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','success','error')),
  trigger_source text,
  error_message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intouch_sync_runs_fn_started_idx
  ON public.intouch_sync_runs (function_name, started_at DESC);

GRANT SELECT ON public.intouch_sync_runs TO authenticated;
GRANT ALL ON public.intouch_sync_runs TO service_role;

ALTER TABLE public.intouch_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/Manager can read sync runs"
ON public.intouch_sync_runs
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'manager'::app_role)
);
