-- New role: production_office_admin — an office-only admin (planner / SKU / RAG /
-- targets / reports) with NO shop-floor or work-order actions. Data access
-- mirrors the planner role on the office tables (additive RLS, so existing
-- roles are unaffected). Applied live; kept for the record.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'production_office_admin';

-- Additive office-data policies (OR'd with the existing planner policies).
DROP POLICY IF EXISTS "office_admin all" ON public.sku_products;
CREATE POLICY "office_admin all" ON public.sku_products FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'production_office_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'production_office_admin'::app_role));

DROP POLICY IF EXISTS "office_admin all" ON public.rag_weekly_entries;
CREATE POLICY "office_admin all" ON public.rag_weekly_entries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'production_office_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'production_office_admin'::app_role));

DROP POLICY IF EXISTS "office_admin all" ON public.production_targets;
CREATE POLICY "office_admin all" ON public.production_targets FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'production_office_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'production_office_admin'::app_role));

DROP POLICY IF EXISTS "office_admin all" ON public.production_sessions;
CREATE POLICY "office_admin all" ON public.production_sessions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'production_office_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'production_office_admin'::app_role));

DROP POLICY IF EXISTS "office_admin all" ON public.production_items;
CREATE POLICY "office_admin all" ON public.production_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'production_office_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'production_office_admin'::app_role));

DROP POLICY IF EXISTS "office_admin read" ON public.products;
CREATE POLICY "office_admin read" ON public.products FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'production_office_admin'::app_role));

DROP POLICY IF EXISTS "office_admin read" ON public.sku_production_history;
CREATE POLICY "office_admin read" ON public.sku_production_history FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'production_office_admin'::app_role));
