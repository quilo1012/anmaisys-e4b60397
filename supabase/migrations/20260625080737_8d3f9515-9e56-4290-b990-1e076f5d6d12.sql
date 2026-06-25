CREATE TABLE public.production_downtimes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_date date NOT NULL DEFAULT CURRENT_DATE,
  shift text NOT NULL CHECK (shift IN ('DAY','NIGHT')),
  line text NOT NULL,
  category text NOT NULL,
  reason text,
  duration_minutes integer NOT NULL CHECK (duration_minutes >= 0),
  started_at timestamptz,
  ended_at timestamptz,
  leader_name text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_downtimes TO authenticated;
GRANT ALL ON public.production_downtimes TO service_role;

ALTER TABLE public.production_downtimes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view production downtimes"
  ON public.production_downtimes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Shop floor can insert production downtimes"
  ON public.production_downtimes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(),'engineer'::app_role)
    OR public.has_role(auth.uid(),'operator'::app_role)
  );

CREATE POLICY "Managers can update production downtimes"
  ON public.production_downtimes FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'maintenance_manager'::app_role)
  );

CREATE POLICY "Managers can delete production downtimes"
  ON public.production_downtimes FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
  );

CREATE TRIGGER set_production_downtimes_updated_at
BEFORE UPDATE ON public.production_downtimes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_production_downtimes_date ON public.production_downtimes(occurred_date DESC);
CREATE INDEX idx_production_downtimes_line ON public.production_downtimes(line);