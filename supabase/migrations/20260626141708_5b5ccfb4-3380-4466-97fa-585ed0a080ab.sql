
CREATE TABLE IF NOT EXISTS public.rag_week_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  line text NOT NULL,
  shift text NOT NULL CHECK (shift IN ('DAY','NIGHT','ALL')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_date, line, shift)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rag_week_exclusions TO authenticated;
GRANT ALL ON public.rag_week_exclusions TO service_role;
ALTER TABLE public.rag_week_exclusions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read rag exclusions" ON public.rag_week_exclusions FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/manager write rag exclusions" ON public.rag_week_exclusions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role));
ALTER PUBLICATION supabase_realtime ADD TABLE public.rag_week_exclusions;
