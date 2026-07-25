-- Atomicity fixes surfaced by the front-end audit.
--
-- 1) save_production_items: the Planner previously did DELETE-all-then-INSERT of a
--    session's production_items from the client as two separate requests. If the
--    INSERT failed (bad sku_id FK, RLS, network drop) after the DELETE committed,
--    the session lost ALL its SKUs with no rollback. Doing both inside one plpgsql
--    function makes them a single transaction: a failed insert rolls back the delete.
--    SECURITY INVOKER keeps the existing RLS policies as the authorization boundary.
--
-- 2) increment_product_quantity: receiving a purchase order incremented
--    products.quantity via a client-side read-then-write (select quantity -> update
--    current + qty), which loses concurrent updates. This does an atomic
--    "set quantity = quantity + delta" instead.

CREATE OR REPLACE FUNCTION public.save_production_items(p_session_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE _n int;
BEGIN
  DELETE FROM public.production_items WHERE session_id = p_session_id;

  IF p_items IS NOT NULL AND jsonb_typeof(p_items) = 'array' AND jsonb_array_length(p_items) > 0 THEN
    INSERT INTO public.production_items
      (session_id, sku_id, target_qty, planned_qty, actual_qty, notes, blender_ref)
    SELECT
      p_session_id,
      NULLIF(elem->>'sku_id','')::uuid,
      COALESCE((elem->>'target_qty')::numeric, 0),
      COALESCE((elem->>'planned_qty')::numeric, 0),
      COALESCE((elem->>'actual_qty')::numeric, 0),
      elem->>'notes',
      elem->>'blender_ref'
    FROM jsonb_array_elements(p_items) AS elem;
  END IF;

  SELECT count(*) INTO _n FROM public.production_items WHERE session_id = p_session_id;
  RETURN jsonb_build_object('success', true, 'count', _n);
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_product_quantity(p_product_id uuid, p_delta integer)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.products SET quantity = quantity + p_delta WHERE id = p_product_id;
END;
$function$;
