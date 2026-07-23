-- QC Supervisor logs quality actions and needs the production data (SKU/batch)
-- to auto-fill. It could already read production_sessions and sku_products, but
-- NOT production_items (its read policy only covers admin/manager/engineer/own-line).
-- Grant QC Supervisor read on production_items so the Log-action auto-fill works.
DROP POLICY IF EXISTS "production_items quality_supervisor read" ON public.production_items;
CREATE POLICY "production_items quality_supervisor read"
  ON public.production_items
  FOR SELECT
  USING (public.has_role(auth.uid(), 'quality_supervisor'::app_role));
