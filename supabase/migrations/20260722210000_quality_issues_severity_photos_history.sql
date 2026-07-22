-- Passo 1: promote Quality Actions into an Issues module.
-- Adds severity + photo attachments, a private photo bucket, and an audit trail.

-- Severity (low | medium | high | critical) + attachments (storage paths in quality-photos)
ALTER TABLE public.quality_actions ADD COLUMN IF NOT EXISTS severity text;
ALTER TABLE public.quality_actions ADD COLUMN IF NOT EXISTS attachments text[] NOT NULL DEFAULT '{}';

-- Private bucket for quality issue photos (mirrors wo-photos)
INSERT INTO storage.buckets (id, name, public) VALUES ('quality-photos','quality-photos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Quality roles view quality-photos" ON storage.objects;
CREATE POLICY "Quality roles view quality-photos" ON storage.objects FOR SELECT
  USING (bucket_id='quality-photos' AND (
    has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role) OR has_role(auth.uid(),'co_engineer'::app_role)));

DROP POLICY IF EXISTS "Quality managers upload quality-photos" ON storage.objects;
CREATE POLICY "Quality managers upload quality-photos" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id='quality-photos' AND (
    has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)));

DROP POLICY IF EXISTS "Quality managers delete quality-photos" ON storage.objects;
CREATE POLICY "Quality managers delete quality-photos" ON storage.objects FOR DELETE
  USING (bucket_id='quality-photos' AND (
    has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)));

-- Audit trail: one row per create / status change / severity change
CREATE TABLE IF NOT EXISTS public.quality_action_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES public.quality_actions(id) ON DELETE CASCADE,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  field text NOT NULL,
  old_value text,
  new_value text
);
CREATE INDEX IF NOT EXISTS idx_qah_action ON public.quality_action_history(action_id, changed_at);
ALTER TABLE public.quality_action_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quality_action_history FROM anon, authenticated;
GRANT SELECT ON public.quality_action_history TO authenticated;

DROP POLICY IF EXISTS "Quality roles read action history" ON public.quality_action_history;
CREATE POLICY "Quality roles read action history" ON public.quality_action_history FOR SELECT
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role) OR has_role(auth.uid(),'co_engineer'::app_role));

-- Inserts happen only through this SECURITY DEFINER trigger (no direct INSERT policy).
CREATE OR REPLACE FUNCTION public.log_quality_action_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, COALESCE(NEW.recorded_by, auth.uid()), 'created', NULL, NEW.status);
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'status', OLD.status, NEW.status);
  END IF;
  IF NEW.severity IS DISTINCT FROM OLD.severity THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'severity', OLD.severity, NEW.severity);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_log_quality_action_change ON public.quality_actions;
CREATE TRIGGER trg_log_quality_action_change
  AFTER INSERT OR UPDATE ON public.quality_actions
  FOR EACH ROW EXECUTE FUNCTION public.log_quality_action_change();
