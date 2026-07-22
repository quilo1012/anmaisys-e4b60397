-- Editable option lists for Quality Actions (labels + departments), so admins/
-- quality managers can add/remove values without a code change.
CREATE TABLE IF NOT EXISTS public.quality_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('label', 'department')),
  value text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, value)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quality_options TO authenticated;
GRANT ALL ON public.quality_options TO service_role;
ALTER TABLE public.quality_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quality_options read" ON public.quality_options;
CREATE POLICY "quality_options read" ON public.quality_options
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "quality_options write" ON public.quality_options;
CREATE POLICY "quality_options write" ON public.quality_options
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'supervisor'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'supervisor'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
  );

ALTER TABLE public.quality_options REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.quality_options;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed with the current fixed lists.
INSERT INTO public.quality_options (kind, value, sort) VALUES
  ('label', 'Batch code', 1),
  ('label', 'CCP', 2),
  ('label', 'Foreign Body', 3),
  ('label', 'GMP', 4),
  ('label', 'Health & Safety', 5),
  ('label', 'Label', 6),
  ('label', 'Maintenance', 7),
  ('label', 'Paperwork', 8),
  ('label', 'Office', 9),
  ('department', 'Supervisor', 1),
  ('department', 'Quality', 2),
  ('department', 'Warehouse', 3)
ON CONFLICT (kind, value) DO NOTHING;
