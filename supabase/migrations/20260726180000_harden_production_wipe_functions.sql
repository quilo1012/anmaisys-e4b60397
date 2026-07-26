-- SECURITY: three SECURITY DEFINER functions that destroy production data had an
-- INVERTED auth guard and were EXECUTE-able by anon (via the PUBLIC grant):
--
--   IF auth.uid() IS NOT NULL AND NOT (has_role admin/manager) THEN RAISE ...
--
-- For an anonymous caller auth.uid() IS NULL, so the AND short-circuits, the
-- exception is skipped, and the body runs as the function owner (bypassing RLS).
-- Anyone holding only the public anon key could POST /rest/v1/rpc/<fn> with no
-- session and wipe production_items / production_blender_entries, re-map SKUs,
-- or bulk-rewrite sku_id.
--
-- Fix: correct the guard to reject anon (auth.uid() IS NULL OR NOT (...)) and
-- remove the anon/PUBLIC EXECUTE grant, leaving only authenticated. This mirrors
-- the guard already used by import_sku_products / import_production_rows /
-- snapshot_sku_products / restore_sku_products_from_backup.
--
-- (Found by the Production Control security audit; applied directly to the live
-- DB since Lovable does not deploy migrations. Kept here for the record.)

CREATE OR REPLACE FUNCTION public.clear_all_production()
 RETURNS TABLE(items_deleted integer, blenders_deleted integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _i integer; _b integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  DELETE FROM public.production_blender_entries;
  GET DIAGNOSTICS _b = ROW_COUNT;
  DELETE FROM public.production_items;
  GET DIAGNOSTICS _i = ROW_COUNT;
  RETURN QUERY SELECT _i, _b;
END $function$;
REVOKE EXECUTE ON FUNCTION public.clear_all_production() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.clear_all_production() FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_all_production() TO authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_batch_skus()
 RETURNS TABLE(repointed integer, deleted integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _rep integer; _del integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  WITH batch AS (
    SELECT s.id, regexp_replace(s.code, '\s*-\s*B[0-9]+\s*$', '') AS base_code
    FROM public.sku_products s WHERE s.code ~ '\s*-\s*B[0-9]+\s*$'
  ), mapping AS (
    SELECT b.id AS batch_id, base.id AS base_id
    FROM batch b JOIN public.sku_products base ON base.code = b.base_code
  )
  UPDATE public.production_items pi SET sku_id = m.base_id FROM mapping m WHERE pi.sku_id = m.batch_id;
  GET DIAGNOSTICS _rep = ROW_COUNT;
  DELETE FROM public.sku_products s
  WHERE s.code ~ '\s*-\s*B[0-9]+\s*$'
    AND EXISTS (SELECT 1 FROM public.sku_products base WHERE base.code = regexp_replace(s.code, '\s*-\s*B[0-9]+\s*$',''))
    AND NOT EXISTS (SELECT 1 FROM public.production_items pi WHERE pi.sku_id = s.id);
  GET DIAGNOSTICS _del = ROW_COUNT;
  RETURN QUERY SELECT _rep, _del;
END $function$;
REVOKE EXECUTE ON FUNCTION public.cleanup_batch_skus() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_batch_skus() FROM anon;
GRANT EXECUTE ON FUNCTION public.cleanup_batch_skus() TO authenticated;

CREATE OR REPLACE FUNCTION public.restore_item_skus_from_backup()
 RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _n integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE public.production_items pi
  SET sku_id = COALESCE(
    (select s.id from public.sku_products s where s.id = bkp.sku_id),
    (select base.id from public._bkp_sku_products_20260722 bs
       join public.sku_products base on base.code = regexp_replace(bs.code, '\s*-\s*B[0-9]+\s*$','')
      where bs.id = bkp.sku_id)
  )
  FROM public._bkp_production_items_20260722 bkp
  WHERE pi.id = bkp.id
    AND pi.sku_id IS NULL
    AND bkp.sku_id IS NOT NULL
    AND COALESCE(
      (select s.id from public.sku_products s where s.id = bkp.sku_id),
      (select base.id from public._bkp_sku_products_20260722 bs
         join public.sku_products base on base.code = regexp_replace(bs.code, '\s*-\s*B[0-9]+\s*$','')
        where bs.id = bkp.sku_id)
    ) IS NOT NULL;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $function$;
REVOKE EXECUTE ON FUNCTION public.restore_item_skus_from_backup() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_item_skus_from_backup() FROM anon;
GRANT EXECUTE ON FUNCTION public.restore_item_skus_from_backup() TO authenticated;
