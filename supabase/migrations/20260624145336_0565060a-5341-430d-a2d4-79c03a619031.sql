
-- Helper trigger function (reuse pattern)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================
-- 1. sku_products (renamed from ANPlaner's products)
-- =========================================================
CREATE TABLE public.sku_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  target_per_hour NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sku_products TO authenticated;
GRANT ALL ON public.sku_products TO service_role;
ALTER TABLE public.sku_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sku_products read all auth" ON public.sku_products
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sku_products write admin/manager" ON public.sku_products
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE TRIGGER trg_sku_products_updated BEFORE UPDATE ON public.sku_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 2. production_targets
-- =========================================================
CREATE TABLE public.production_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sku_id UUID NOT NULL REFERENCES public.sku_products(id) ON DELETE CASCADE,
  line TEXT NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('DAY','NIGHT')),
  target_qty NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sku_id, line, shift)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_targets TO authenticated;
GRANT ALL ON public.production_targets TO service_role;
ALTER TABLE public.production_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "production_targets read all auth" ON public.production_targets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "production_targets write admin/manager" ON public.production_targets
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE TRIGGER trg_production_targets_updated BEFORE UPDATE ON public.production_targets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 3. production_sessions
-- =========================================================
CREATE TABLE public.production_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  line TEXT NOT NULL,
  session_date DATE NOT NULL,
  shift TEXT NOT NULL CHECK (shift IN ('DAY','NIGHT')),
  started_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (line, session_date, shift)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_sessions TO authenticated;
GRANT ALL ON public.production_sessions TO service_role;
ALTER TABLE public.production_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "production_sessions read all auth" ON public.production_sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "production_sessions insert auth" ON public.production_sessions
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "production_sessions update auth" ON public.production_sessions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "production_sessions delete admin/manager" ON public.production_sessions
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE TRIGGER trg_production_sessions_updated BEFORE UPDATE ON public.production_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 4. production_items
-- =========================================================
CREATE TABLE public.production_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.production_sessions(id) ON DELETE CASCADE,
  sku_id UUID NOT NULL REFERENCES public.sku_products(id) ON DELETE RESTRICT,
  planned_qty NUMERIC NOT NULL DEFAULT 0,
  actual_qty NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_production_items_session ON public.production_items(session_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_items TO authenticated;
GRANT ALL ON public.production_items TO service_role;
ALTER TABLE public.production_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "production_items read all auth" ON public.production_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "production_items insert auth" ON public.production_items
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "production_items update auth" ON public.production_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "production_items delete admin/manager" ON public.production_items
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE TRIGGER trg_production_items_updated BEFORE UPDATE ON public.production_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 5. quality_action_types
-- =========================================================
CREATE TABLE public.quality_action_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quality_action_types TO authenticated;
GRANT ALL ON public.quality_action_types TO service_role;
ALTER TABLE public.quality_action_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quality_action_types read all auth" ON public.quality_action_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "quality_action_types write admin/manager" ON public.quality_action_types
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE TRIGGER trg_quality_action_types_updated BEFORE UPDATE ON public.quality_action_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 6. quality_actions
-- =========================================================
CREATE TABLE public.quality_actions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.production_sessions(id) ON DELETE SET NULL,
  action_type_id UUID NOT NULL REFERENCES public.quality_action_types(id) ON DELETE RESTRICT,
  line TEXT,
  description TEXT,
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quality_actions_session ON public.quality_actions(session_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quality_actions TO authenticated;
GRANT ALL ON public.quality_actions TO service_role;
ALTER TABLE public.quality_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quality_actions read all auth" ON public.quality_actions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "quality_actions insert auth" ON public.quality_actions
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "quality_actions update auth" ON public.quality_actions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "quality_actions delete admin/manager" ON public.quality_actions
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE TRIGGER trg_quality_actions_updated BEFORE UPDATE ON public.quality_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
