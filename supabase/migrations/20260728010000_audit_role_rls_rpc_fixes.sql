-- Pre-production audit fixes — role RLS/RPC gaps (UI granted vs DB blocked).
-- Applied live; kept for the record.

-- 1) RAG comments: production_office_admin (has rag.comment in MATRIX) had no
--    policy, and supervisor could INSERT but not UPDATE (upsert onConflict hit
--    the admin/manager-only UPDATE policy) — both errored via toast.
DROP POLICY IF EXISTS "office_admin rag comments" ON public.rag_weekly_comments;
CREATE POLICY "office_admin rag comments" ON public.rag_weekly_comments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'production_office_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'production_office_admin'::app_role));

DROP POLICY IF EXISTS "supervisor update rag comments" ON public.rag_weekly_comments;
CREATE POLICY "supervisor update rag comments" ON public.rag_weekly_comments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'supervisor'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'supervisor'::app_role));

-- 2) SKU bulk import: allow production_office_admin (has sku.manage + RLS + sees
--    the Import button) and map the Weight column (was silently dropped even
--    though sku_products.weight exists and the client sends it). COALESCE keeps
--    an existing weight when a re-import omits it.
CREATE OR REPLACE FUNCTION public.import_sku_products(_rows jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _count integer := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT (public.has_role(_uid, 'admin'::public.app_role) OR public.has_role(_uid, 'manager'::public.app_role) OR public.has_role(_uid, 'supervisor'::public.app_role) OR public.has_role(_uid, 'planner'::public.app_role) OR public.has_role(_uid, 'production_office_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden: admin, manager, supervisor, planner or production office admin role required';
  END IF;
  WITH prepared AS (
    SELECT DISTINCT ON (lower(trim(item->>'code')))
      trim(item->>'code') AS code, trim(item->>'name') AS name,
      nullif(trim(coalesce(item->>'category', '')), '') AS category,
      CASE
        WHEN nullif(trim(coalesce(item->>'target_per_hour', '')), '') IS NULL THEN 0::numeric
        WHEN trim(item->>'target_per_hour') ~ '^[0-9]+([\.,][0-9]+)?$' THEN replace(trim(item->>'target_per_hour'), ',', '.')::numeric
        ELSE 0::numeric
      END AS target_per_hour,
      CASE
        WHEN nullif(trim(coalesce(item->>'weight', '')), '') IS NULL THEN NULL::numeric
        WHEN trim(item->>'weight') ~ '^[0-9]+([\.,][0-9]+)?$' THEN replace(trim(item->>'weight'), ',', '.')::numeric
        ELSE NULL::numeric
      END AS weight,
      COALESCE((item->>'active')::boolean, true) AS active
    FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) AS item
    WHERE nullif(trim(coalesce(item->>'code', '')), '') IS NOT NULL
      AND nullif(trim(coalesce(item->>'name', '')), '') IS NOT NULL
    ORDER BY lower(trim(item->>'code')), length(trim(item->>'name')) DESC
  ), upserted AS (
    INSERT INTO public.sku_products (code, name, category, target_per_hour, weight, active)
    SELECT code, name, category, target_per_hour, weight, active FROM prepared
    ON CONFLICT (code) DO UPDATE SET
      name = EXCLUDED.name, category = EXCLUDED.category,
      target_per_hour = EXCLUDED.target_per_hour,
      weight = COALESCE(EXCLUDED.weight, public.sku_products.weight),
      active = EXCLUDED.active, updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO _count FROM upserted;
  RETURN jsonb_build_object('success', true, 'count', _count);
END; $function$;

-- 3) Production import: maintenance_manager sees the "Import Production" button
--    (ShiftHistory isAdmin group) but the RPC rejected it. Align the guard.
CREATE OR REPLACE FUNCTION public.import_production_rows(_rows jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _sessions int := 0;
  _items int := 0;
  _freetext int := 0;
  _rec record;
  _session_id uuid;
  _sku_id uuid;
BEGIN
  IF _uid IS NULL OR NOT (
    has_role(_uid,'admin'::app_role) OR has_role(_uid,'manager'::app_role) OR has_role(_uid,'supervisor'::app_role) OR has_role(_uid,'maintenance_manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin, manager, supervisor or maintenance manager role required';
  END IF;

  FOR _rec IN
    SELECT
      (r->>'date')::date         AS session_date,
      upper(r->>'shift')         AS shift,
      btrim(r->>'line')          AS line,
      btrim(r->>'sku_code')      AS sku_code,
      sum((r->>'qty')::numeric)  AS qty
    FROM jsonb_array_elements(coalesce(_rows, '[]'::jsonb)) AS r
    WHERE coalesce(btrim(r->>'line'), '') <> ''
      AND coalesce(btrim(r->>'sku_code'), '') <> ''
      AND (r->>'qty') ~ '^-?\d+(\.\d+)?$'
      AND (r->>'qty')::numeric > 0
    GROUP BY 1, 2, 3, 4
  LOOP
    SELECT id INTO _session_id FROM public.production_sessions
      WHERE session_date = _rec.session_date AND shift = _rec.shift AND line = _rec.line
      LIMIT 1;
    IF _session_id IS NULL THEN
      INSERT INTO public.production_sessions (session_date, shift, line)
        VALUES (_rec.session_date, _rec.shift, _rec.line)
        RETURNING id INTO _session_id;
    END IF;
    _sessions := _sessions + 1;

    SELECT id INTO _sku_id FROM public.sku_products
      WHERE lower(btrim(code)) = lower(_rec.sku_code) LIMIT 1;
    IF _sku_id IS NULL THEN
      SELECT id INTO _sku_id FROM public.sku_products
        WHERE lower(regexp_replace(btrim(code), '\s*-\s*b\d+\s*$', '', 'i'))
            = lower(regexp_replace(_rec.sku_code, '\s*-\s*b\d+\s*$', '', 'i'))
        LIMIT 1;
    END IF;

    IF _sku_id IS NOT NULL THEN
      UPDATE public.production_items SET actual_qty = _rec.qty
        WHERE session_id = _session_id AND sku_id = _sku_id;
      IF NOT FOUND THEN
        INSERT INTO public.production_items (session_id, sku_id, target_qty, planned_qty, actual_qty)
          VALUES (_session_id, _sku_id, 0, 0, _rec.qty);
      END IF;
    ELSE
      UPDATE public.production_items SET actual_qty = _rec.qty
        WHERE session_id = _session_id AND sku_id IS NULL AND sku_code_text = _rec.sku_code;
      IF NOT FOUND THEN
        INSERT INTO public.production_items (session_id, sku_id, sku_code_text, target_qty, planned_qty, actual_qty)
          VALUES (_session_id, NULL, _rec.sku_code, 0, 0, _rec.qty);
      END IF;
      _freetext := _freetext + 1;
    END IF;
    _items := _items + 1;
  END LOOP;

  RETURN jsonb_build_object('sessions', _sessions, 'items', _items, 'freetext', _freetext);
END;
$function$;
