CREATE OR REPLACE FUNCTION public.import_sku_products(_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _count integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (public.has_role(_uid, 'admin'::public.app_role) OR public.has_role(_uid, 'manager'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden: admin or manager role required';
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
$$;

REVOKE ALL ON FUNCTION public.import_sku_products(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_sku_products(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_sku_products(jsonb) TO service_role;