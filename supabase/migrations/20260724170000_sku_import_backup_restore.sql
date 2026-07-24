-- Importing SKUs used to DELETE the whole catalog first (frontend), so a bad file
-- wiped everything. The importer RPC already upserts by code, so the frontend now
-- just merges. On top of that, snapshot the catalog before each import and add a
-- one-click restore ("Restore previous import").

CREATE TABLE IF NOT EXISTS public.sku_products_backup (LIKE public.sku_products INCLUDING DEFAULTS);
ALTER TABLE public.sku_products_backup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sku_backup admin manage" ON public.sku_products_backup;
CREATE POLICY "sku_backup admin manage" ON public.sku_products_backup FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

CREATE OR REPLACE FUNCTION public.snapshot_sku_products()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _uid uuid := auth.uid(); _n int;
BEGIN
  IF _uid IS NULL OR NOT (has_role(_uid,'admin'::app_role) OR has_role(_uid,'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden: admin or manager role required';
  END IF;
  TRUNCATE public.sku_products_backup;
  INSERT INTO public.sku_products_backup SELECT * FROM public.sku_products;
  SELECT count(*) INTO _n FROM public.sku_products_backup;
  RETURN jsonb_build_object('success', true, 'count', _n);
END; $function$;

CREATE OR REPLACE FUNCTION public.restore_sku_products_from_backup()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _uid uuid := auth.uid(); _n int;
BEGIN
  IF _uid IS NULL OR NOT (has_role(_uid,'admin'::app_role) OR has_role(_uid,'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden: admin or manager role required';
  END IF;
  SELECT count(*) INTO _n FROM public.sku_products_backup;
  IF _n = 0 THEN RAISE EXCEPTION 'No previous import to restore'; END IF;
  DELETE FROM public.sku_products;
  INSERT INTO public.sku_products SELECT * FROM public.sku_products_backup;
  RETURN jsonb_build_object('success', true, 'count', _n);
END; $function$;
