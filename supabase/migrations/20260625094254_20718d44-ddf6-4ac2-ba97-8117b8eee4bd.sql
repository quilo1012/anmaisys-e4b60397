CREATE TABLE public.line_leaders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  shift text NOT NULL CHECK (shift IN ('DAY','NIGHT','BOTH')),
  line text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.line_leaders TO authenticated;
GRANT ALL ON public.line_leaders TO service_role;
ALTER TABLE public.line_leaders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "line_leaders_read_auth" ON public.line_leaders FOR SELECT TO authenticated USING (true);
CREATE POLICY "line_leaders_write_mgr" ON public.line_leaders FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role));
CREATE TRIGGER line_leaders_set_updated_at BEFORE UPDATE ON public.line_leaders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX line_leaders_shift_idx ON public.line_leaders(shift) WHERE active;