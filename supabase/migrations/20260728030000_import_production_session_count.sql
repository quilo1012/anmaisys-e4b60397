-- Audit fix (low): import_production_rows counted "sessions" per grouped row
-- (== items), overstating the toast ("40 SKUs in a shift -> 40 sessions"). Track
-- DISTINCT session ids touched and return that instead. Applied live; for the record.
CREATE OR REPLACE FUNCTION public.import_production_rows(_rows jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _touched uuid[] := '{}';
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
    IF NOT (_session_id = ANY(_touched)) THEN
      _touched := array_append(_touched, _session_id);
    END IF;

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

  RETURN jsonb_build_object('sessions', coalesce(array_length(_touched, 1), 0), 'items', _items, 'freetext', _freetext);
END;
$function$;
