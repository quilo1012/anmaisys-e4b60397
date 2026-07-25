-- Give the production supervisor the same access to SKU Products as admin/manager:
-- the page (route + nav + sku.manage) is opened to supervisor on the frontend,
-- but every write path is gated to admin/manager here in the database, so
-- without this the page would load and then fail on save/import/restore.
--
-- Two gates to widen:
--   1. Direct row writes on sku_products (Save / edit / delete a SKU) → RLS.
--   2. The SECURITY DEFINER import/snapshot/restore/cleanup functions → their
--      internal role check.

-- 1) RLS write policy — add supervisor.
DROP POLICY IF EXISTS "sku_products write admin/manager" ON public.sku_products;
CREATE POLICY "sku_products write admin/manager/supervisor"
  ON public.sku_products
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'supervisor'::public.app_role)
  );

-- 2) Bodies unchanged except for the role check, which now also accepts supervisor.

CREATE OR REPLACE FUNCTION public.import_sku_products(_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _count integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(_uid, 'admin'::public.app_role) OR public.has_role(_uid, 'manager'::public.app_role) OR public.has_role(_uid, 'supervisor'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden: admin, manager or supervisor role required';
  END IF;

  WITH prepared AS (
    SELECT DISTINCT ON (lower(trim(item->>'code')))
      trim(item->>'code') AS code,
      trim(item->>'name') AS name,
      nullif(trim(coalesce(item->>'category', '')), '') AS category,
      CASE
        WHEN nullif(trim(coalesce(item->>'target_per_hour', '')), '') IS NULL THEN 0::numeric
        WHEN trim(item->>'target_per_hour') ~ '^[0-9]+([\.,][0-9]+)?$' THEN replace(trim(item->>'target_per_hour'), ',', '.')::numeric
        ELSE 0::numeric
      END AS target_per_hour,
      COALESCE((item->>'active')::boolean, true) AS active
    FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) AS item
    WHERE nullif(trim(coalesce(item->>'code', '')), '') IS NOT NULL
      AND nullif(trim(coalesce(item->>'name', '')), '') IS NOT NULL
    ORDER BY lower(trim(item->>'code')), length(trim(item->>'name')) DESC
  ), upserted AS (
    INSERT INTO public.sku_products (code, name, category, target_per_hour, active)
    SELECT code, name, category, target_per_hour, active
    FROM prepared
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name,
      category = EXCLUDED.category,
      target_per_hour = EXCLUDED.target_per_hour,
      active = EXCLUDED.active,
      updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO _count FROM upserted;

  RETURN jsonb_build_object('success', true, 'count', _count);
END;
$function$;

CREATE OR REPLACE FUNCTION public.snapshot_sku_products()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _n int;
BEGIN
  IF _uid IS NULL OR NOT (has_role(_uid,'admin'::app_role) OR has_role(_uid,'manager'::app_role) OR has_role(_uid,'supervisor'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden: admin, manager or supervisor role required';
  END IF;
  TRUNCATE public.sku_products_backup;
  INSERT INTO public.sku_products_backup SELECT * FROM public.sku_products;
  SELECT count(*) INTO _n FROM public.sku_products_backup;
  RETURN jsonb_build_object('success', true, 'count', _n);
END; $function$;

CREATE OR REPLACE FUNCTION public.restore_sku_products_from_backup()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _n int;
BEGIN
  IF _uid IS NULL OR NOT (has_role(_uid,'admin'::app_role) OR has_role(_uid,'manager'::app_role) OR has_role(_uid,'supervisor'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden: admin, manager or supervisor role required';
  END IF;
  SELECT count(*) INTO _n FROM public.sku_products_backup;
  IF _n = 0 THEN RAISE EXCEPTION 'No previous import to restore'; END IF;
  DELETE FROM public.sku_products;
  INSERT INTO public.sku_products SELECT * FROM public.sku_products_backup;
  RETURN jsonb_build_object('success', true, 'count', _n);
END; $function$;

CREATE OR REPLACE FUNCTION public.cleanup_batch_skus()
 RETURNS TABLE(repointed integer, deleted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _rep integer; _del integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'supervisor')) THEN
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
