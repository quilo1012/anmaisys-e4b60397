
CREATE TABLE IF NOT EXISTS public.login_branding (
  mode TEXT PRIMARY KEY CHECK (mode IN ('staff','tablet')),
  url TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT ON public.login_branding TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.login_branding TO authenticated;
GRANT ALL ON public.login_branding TO service_role;

ALTER TABLE public.login_branding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read login branding"
  ON public.login_branding FOR SELECT
  USING (true);

CREATE POLICY "Admins manage login branding"
  ON public.login_branding FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Storage policies for the "branding" bucket
CREATE POLICY "Public read branding bucket"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'branding');

CREATE POLICY "Admins upload branding"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'branding' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update branding"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'branding' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins delete branding"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'branding' AND has_role(auth.uid(), 'admin'::app_role));
