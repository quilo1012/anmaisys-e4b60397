-- Weekly quality report data, entered manually by the QC supervisor.
-- One row per (week_start, line). Actions count and % error are NOT stored:
-- they are derived from public.quality_actions at read time.

CREATE TABLE IF NOT EXISTS public.quality_weekly_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  line text NOT NULL,
  batches integer NOT NULL DEFAULT 0,
  qas_checks integer NOT NULL DEFAULT 0,
  ccp_checks integer NOT NULL DEFAULT 0,
  toolbox_checks integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_start, line)
);

CREATE INDEX IF NOT EXISTS idx_quality_weekly_stats_week
  ON public.quality_weekly_stats (week_start, line);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quality_weekly_stats TO authenticated;
GRANT ALL ON public.quality_weekly_stats TO service_role;

ALTER TABLE public.quality_weekly_stats ENABLE ROW LEVEL SECURITY;

-- keep updated_at fresh (reuses the same trigger fn as quality_actions)
DROP TRIGGER IF EXISTS trg_quality_weekly_stats_updated ON public.quality_weekly_stats;
CREATE TRIGGER trg_quality_weekly_stats_updated
  BEFORE UPDATE ON public.quality_weekly_stats
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Read: anyone who can view quality
DROP POLICY IF EXISTS "quality_weekly_stats read" ON public.quality_weekly_stats;
CREATE POLICY "quality_weekly_stats read" ON public.quality_weekly_stats
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
DROP POLICY IF EXISTS "quality_weekly_stats write" ON public.quality_weekly_stats;
CREATE POLICY "quality_weekly_stats write" ON public.quality_weekly_stats
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

-- realtime
ALTER TABLE public.quality_weekly_stats REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.quality_weekly_stats;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Fix quality_actions RLS so the QC supervisor (and production supervisor) can
-- read across all lines and write actions. Previously write was admin/manager
-- only and the scoped-read policy omitted supervisor entirely.

DROP POLICY IF EXISTS "quality_actions insert admin/manager" ON public.quality_actions;
DROP POLICY IF EXISTS "quality_actions insert quality staff" ON public.quality_actions;
CREATE POLICY "quality_actions insert quality staff" ON public.quality_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'supervisor'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
  );

DROP POLICY IF EXISTS "quality_actions update admin/manager" ON public.quality_actions;
DROP POLICY IF EXISTS "quality_actions update quality staff" ON public.quality_actions;
CREATE POLICY "quality_actions update quality staff" ON public.quality_actions
  FOR UPDATE TO authenticated
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

DROP POLICY IF EXISTS "quality_actions scoped read" ON public.quality_actions;
CREATE POLICY "quality_actions scoped read" ON public.quality_actions
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(),'engineer'::app_role)
    OR public.has_role(auth.uid(),'supervisor'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
    OR quality_actions.line = ANY(public.current_user_line_names())
  );
