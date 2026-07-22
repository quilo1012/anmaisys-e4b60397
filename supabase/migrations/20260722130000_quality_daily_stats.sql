-- Daily quality stats (batches + checks), entered per (stat_date, line).
-- Weekly and monthly reports are aggregated from these daily rows.
CREATE TABLE IF NOT EXISTS public.quality_daily_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stat_date date NOT NULL,
  line text NOT NULL,
  batches integer NOT NULL DEFAULT 0,
  qas_checks integer NOT NULL DEFAULT 0,
  ccp_checks integer NOT NULL DEFAULT 0,
  toolbox_checks integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stat_date, line)
);

CREATE INDEX IF NOT EXISTS idx_quality_daily_stats_date
  ON public.quality_daily_stats (stat_date, line);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quality_daily_stats TO authenticated;
GRANT ALL ON public.quality_daily_stats TO service_role;

ALTER TABLE public.quality_daily_stats ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_quality_daily_stats_updated ON public.quality_daily_stats;
CREATE TRIGGER trg_quality_daily_stats_updated
  BEFORE UPDATE ON public.quality_daily_stats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Read: anyone who can view quality
DROP POLICY IF EXISTS "quality_daily_stats read" ON public.quality_daily_stats;
CREATE POLICY "quality_daily_stats read" ON public.quality_daily_stats
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'supervisor'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
    OR public.has_role(auth.uid(),'engineer'::app_role)
    OR public.has_role(auth.uid(),'co_engineer'::app_role)
  );

-- Write: quality managers
DROP POLICY IF EXISTS "quality_daily_stats write" ON public.quality_daily_stats;
CREATE POLICY "quality_daily_stats write" ON public.quality_daily_stats
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

ALTER TABLE public.quality_daily_stats REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.quality_daily_stats;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Carry any previously-entered weekly rows onto their Monday date so no data is
-- lost when switching to daily entry. Guarded in case the weekly table is absent.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'quality_weekly_stats'
  ) THEN
    INSERT INTO public.quality_daily_stats
      (stat_date, line, batches, qas_checks, ccp_checks, toolbox_checks, created_by)
    SELECT week_start, line, batches, qas_checks, ccp_checks, toolbox_checks, created_by
    FROM public.quality_weekly_stats
    ON CONFLICT (stat_date, line) DO NOTHING;
  END IF;
END $$;
