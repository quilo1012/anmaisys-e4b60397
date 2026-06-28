CREATE TABLE IF NOT EXISTS public.intouch_quota_status (
  id text PRIMARY KEY DEFAULT 'singleton',
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.intouch_quota_status TO service_role;
GRANT SELECT ON public.intouch_quota_status TO authenticated;

ALTER TABLE public.intouch_quota_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read intouch quota status"
ON public.intouch_quota_status
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));
