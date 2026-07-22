-- Passo 4: Audits (planning, checklist, result, photos, signatures).
-- Checklist items stored as JSONB; photos reuse the private quality-photos bucket.
CREATE TABLE IF NOT EXISTS public.audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_no text,
  title text,
  audit_type text NOT NULL DEFAULT 'internal',   -- internal | external | supplier | customer | process
  area text,
  auditor_name text,
  auditee_name text,
  planned_date date,
  performed_date date,
  status text NOT NULL DEFAULT 'planned',         -- planned | in_progress | completed
  result text,                                     -- pass | conditional | fail
  score integer,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,         -- [{ clause, requirement, result, note }]
  attachments text[] NOT NULL DEFAULT '{}',
  summary text,
  auditor_signature text,
  auditor_signed_at timestamptz,
  auditee_signature text,
  auditee_signed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audits_date ON public.audits(coalesce(performed_date, planned_date) DESC);
ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audits FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audits TO authenticated;

DROP TRIGGER IF EXISTS trg_audits_updated ON public.audits;
CREATE TRIGGER trg_audits_updated BEFORE UPDATE ON public.audits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP POLICY IF EXISTS "Quality roles read audits" ON public.audits;
CREATE POLICY "Quality roles read audits" ON public.audits FOR SELECT
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role) OR has_role(auth.uid(),'co_engineer'::app_role));

DROP POLICY IF EXISTS "Quality managers write audits" ON public.audits;
CREATE POLICY "Quality managers write audits" ON public.audits FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role));
