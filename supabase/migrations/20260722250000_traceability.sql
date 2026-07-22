-- Passo 5: Traceability. Finished lot identity = production batch code (blender_ref),
-- so no production data is duplicated. Suppliers/materials are text (denormalized).
CREATE TABLE IF NOT EXISTS public.raw_material_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_name text NOT NULL,
  supplier_name text,
  supplier_lot text,
  received_on date,
  quantity numeric,
  unit text,
  expiry_date date,
  coa_ref text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.raw_material_lots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.raw_material_lots FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_material_lots TO authenticated;
DROP TRIGGER IF EXISTS trg_rml_updated ON public.raw_material_lots;
CREATE TRIGGER trg_rml_updated BEFORE UPDATE ON public.raw_material_lots FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.batch_material_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code text NOT NULL,
  raw_material_lot_id uuid NOT NULL REFERENCES public.raw_material_lots(id) ON DELETE CASCADE,
  quantity_used numeric,
  unit text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bmu_batch ON public.batch_material_usage(batch_code);
ALTER TABLE public.batch_material_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.batch_material_usage FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_material_usage TO authenticated;

CREATE TABLE IF NOT EXISTS public.batch_dispatch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_code text NOT NULL,
  customer_name text NOT NULL,
  dispatch_date date,
  quantity numeric,
  unit text,
  reference text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bd_batch ON public.batch_dispatch(batch_code);
ALTER TABLE public.batch_dispatch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.batch_dispatch FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batch_dispatch TO authenticated;

-- RLS: read = any authenticated (traceability lookup); write = management roles
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['raw_material_lots','batch_material_usage','batch_dispatch'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "trace read" ON public.%I', t);
    EXECUTE format('CREATE POLICY "trace read" ON public.%I FOR SELECT USING (auth.uid() IS NOT NULL)', t);
    EXECUTE format('DROP POLICY IF EXISTS "trace write" ON public.%I', t);
    EXECUTE format($f$CREATE POLICY "trace write" ON public.%I FOR ALL
      USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
        OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
        OR has_role(auth.uid(),'planner'::app_role) OR has_role(auth.uid(),'warehouse'::app_role))
      WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
        OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
        OR has_role(auth.uid(),'planner'::app_role) OR has_role(auth.uid(),'warehouse'::app_role))$f$, t);
  END LOOP;
END $$;
