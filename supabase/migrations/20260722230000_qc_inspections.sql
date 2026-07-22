-- Passo 3: QC checklists / inspections (weight, temperature, metal detector,
-- sealing, labelling, samples) + release decision. Checkpoint results stored as
-- JSONB so the checklist can evolve without schema changes.
CREATE TABLE IF NOT EXISTS public.qc_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line text,
  batch_code text,
  shift text,
  inspected_on date NOT NULL DEFAULT CURRENT_DATE,
  inspector_name text,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { key: { result: pass|fail|na, value: num, note: text } }
  release text NOT NULL DEFAULT 'pending',     -- pending | released | hold | rejected
  notes text,
  status text NOT NULL DEFAULT 'draft',        -- draft | complete
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qc_inspections_date ON public.qc_inspections(inspected_on DESC);
ALTER TABLE public.qc_inspections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.qc_inspections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qc_inspections TO authenticated;

DROP TRIGGER IF EXISTS trg_qc_inspections_updated ON public.qc_inspections;
CREATE TRIGGER trg_qc_inspections_updated BEFORE UPDATE ON public.qc_inspections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "Quality roles read qc" ON public.qc_inspections;
CREATE POLICY "Quality roles read qc" ON public.qc_inspections FOR SELECT
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role) OR has_role(auth.uid(),'co_engineer'::app_role));

DROP POLICY IF EXISTS "Quality managers write qc" ON public.qc_inspections;
CREATE POLICY "Quality managers write qc" ON public.qc_inspections FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role));
