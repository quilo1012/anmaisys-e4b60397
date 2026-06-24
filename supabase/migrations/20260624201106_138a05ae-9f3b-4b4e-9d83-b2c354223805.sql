GRANT SELECT, INSERT, UPDATE, DELETE ON public.sku_products TO authenticated;
GRANT ALL ON public.sku_products TO service_role;
GRANT EXECUTE ON FUNCTION public.import_sku_products(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_sku_products(jsonb) TO service_role;