-- Packaging Verification System (PVS) — Passo 1 foundation.
-- Finished-lot identity stays the SKU/batch; these tables add the material master,
-- production orders, packaging BOM, verification sessions and the immutable scan log.

CREATE TABLE IF NOT EXISTS public.materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_type text NOT NULL DEFAULT 'other',   -- label|bag|tub|lid|scoop|box|other
  barcode text,
  ap_code text,
  description text,
  country text,
  flavour text,
  size text,
  pack_type text,                                  -- BAG|TUB for bags/tubs
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_materials_barcode ON public.materials(barcode) WHERE barcode IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_materials_apcode ON public.materials(ap_code) WHERE ap_code IS NOT NULL;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.materials FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.materials TO authenticated;
DROP TRIGGER IF EXISTS trg_materials_updated ON public.materials;
CREATE TRIGGER trg_materials_updated BEFORE UPDATE ON public.materials FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number text NOT NULL UNIQUE,
  sku text,
  description text,
  country text,
  packaging_type text,                             -- BAG|TUB
  qty integer,
  line text,
  pallet_qr text,
  trello_ref text,
  planned_date date,
  status text NOT NULL DEFAULT 'planned',          -- planned|running|verified|done
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_po_sku ON public.production_orders(sku);
ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.production_orders FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_orders TO authenticated;
DROP TRIGGER IF EXISTS trg_po_updated ON public.production_orders;
CREATE TRIGGER trg_po_updated BEFORE UPDATE ON public.production_orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.packaging_bom (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  packaging_type text NOT NULL,                    -- BAG|TUB
  component text NOT NULL,                          -- label|bag|tub|lid|scoop|box
  material_id uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  required_qty integer NOT NULL DEFAULT 1,
  sequence integer,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sku, packaging_type, component)
);
ALTER TABLE public.packaging_bom ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.packaging_bom FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.packaging_bom TO authenticated;
DROP TRIGGER IF EXISTS trg_bom_updated ON public.packaging_bom;
CREATE TRIGGER trg_bom_updated BEFORE UPDATE ON public.packaging_bom FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.pvs_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.production_orders(id) ON DELETE SET NULL,
  po_number text,
  operator uuid,
  line text,
  status text NOT NULL DEFAULT 'running',          -- running|passed|failed
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pvs_order ON public.pvs_sessions(order_id);
ALTER TABLE public.pvs_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pvs_sessions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pvs_sessions TO authenticated;

CREATE TABLE IF NOT EXISTS public.scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.pvs_sessions(id) ON DELETE CASCADE,
  order_id uuid,
  operator uuid,
  component text,
  expected_material_id uuid,
  scanned_barcode text,
  scanned_material_id uuid,
  result text NOT NULL,                            -- match|mismatch|unknown
  scanned_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_scan_session ON public.scan_events(session_id);
ALTER TABLE public.scan_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scan_events FROM anon;
GRANT SELECT, INSERT ON public.scan_events TO authenticated;  -- append-only (no update/delete grant)

-- Read = any authenticated (operators need materials/orders/bom at scan time)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['materials','production_orders','packaging_bom','pvs_sessions','scan_events'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "pvs read" ON public.%I', t);
    EXECUTE format('CREATE POLICY "pvs read" ON public.%I FOR SELECT USING (auth.uid() IS NOT NULL)', t);
  END LOOP;
END $$;

-- Master data write = management roles
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['materials','production_orders','packaging_bom'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "pvs manage" ON public.%I', t);
    EXECUTE format($f$CREATE POLICY "pvs manage" ON public.%I FOR ALL
      USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
        OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
        OR has_role(auth.uid(),'planner'::app_role) OR has_role(auth.uid(),'warehouse'::app_role))
      WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
        OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'quality_supervisor'::app_role)
        OR has_role(auth.uid(),'planner'::app_role) OR has_role(auth.uid(),'warehouse'::app_role))$f$, t);
  END LOOP;
END $$;

-- Operators run verification: insert/update sessions, insert scans
DROP POLICY IF EXISTS "pvs sessions write" ON public.pvs_sessions;
CREATE POLICY "pvs sessions write" ON public.pvs_sessions FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "pvs scans insert" ON public.scan_events;
CREATE POLICY "pvs scans insert" ON public.scan_events FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
