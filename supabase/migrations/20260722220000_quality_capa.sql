-- Passo 2: CAPA (Corrective & Preventive Action) linked one-to-one to an issue.
CREATE TABLE IF NOT EXISTS public.quality_capa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL UNIQUE REFERENCES public.quality_actions(id) ON DELETE CASCADE,
  capa_no text,
  problem text,
  five_whys jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of up to 5 "why" strings
  root_cause text,
  ishikawa jsonb NOT NULL DEFAULT '{}'::jsonb,     -- { Man, Machine, Method, Material, Measurement, Environment }
  action_plan text,
  responsible text,
  due_date date,
  status text NOT NULL DEFAULT 'open',             -- open | in_progress | verifying | closed
  effectiveness text,
  effectiveness_ok boolean,
  verified_by uuid,
  verified_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quality_capa ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quality_capa FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quality_capa TO authenticated;

DROP TRIGGER IF EXISTS trg_quality_capa_updated ON public.quality_capa;
CREATE TRIGGER trg_quality_capa_updated BEFORE UPDATE ON public.quality_capa
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "Quality roles read capa" ON public.quality_capa;
CREATE POLICY "Quality roles read capa" ON public.quality_capa FOR SELECT
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role) OR has_role(auth.uid(),'co_engineer'::app_role));

DROP POLICY IF EXISTS "Quality managers write capa" ON public.quality_capa;
CREATE POLICY "Quality managers write capa" ON public.quality_capa FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role));
