-- Per-role mobile visibility. A row (role, action) means that action/screen is
-- HIDDEN on mobile for that role. Absence = shown. Toggled from the Permissions
-- Matrix ("Mobile" mode) and enforced in the nav + ProtectedRoute.
CREATE TABLE IF NOT EXISTS public.role_mobile_hidden (
  role text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, action)
);

ALTER TABLE public.role_mobile_hidden ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_mobile_hidden read" ON public.role_mobile_hidden;
CREATE POLICY "role_mobile_hidden read"
  ON public.role_mobile_hidden FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "role_mobile_hidden admin write" ON public.role_mobile_hidden;
CREATE POLICY "role_mobile_hidden admin write"
  ON public.role_mobile_hidden FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

GRANT ALL ON public.role_mobile_hidden TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.role_mobile_hidden;
