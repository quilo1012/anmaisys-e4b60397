-- 2nd audit #2 — the PO "Receive" flow was a client-side read-then-write loop
-- (`current = prod?.quantity ?? 0; update quantity = current + qty`). A null read
-- silently zeroed existing on-hand stock, the writes weren't atomic, and a
-- double-click double-counted. Replace it with a single transactional RPC:
-- in-DB increment, atomic with the status flip, idempotent on status='received'.
-- Applied live; committed for the record.
CREATE OR REPLACE FUNCTION public.receive_purchase_order(_po_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _status text; _n int := 0;
BEGIN
  IF _uid IS NULL OR NOT (has_role(_uid,'admin'::app_role) OR has_role(_uid,'manager'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT status INTO _status FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF _status = 'received' THEN
    RETURN jsonb_build_object('success', true, 'already_received', true, 'products_updated', 0);
  END IF;

  UPDATE public.purchase_orders SET status = 'received', received_at = now() WHERE id = _po_id;

  WITH applied AS (
    UPDATE public.products p
    SET quantity = p.quantity + poi.quantity
    FROM public.purchase_order_items poi
    WHERE poi.purchase_order_id = _po_id AND poi.product_id = p.id
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM applied;

  RETURN jsonb_build_object('success', true, 'products_updated', _n);
END; $function$;

REVOKE EXECUTE ON FUNCTION public.receive_purchase_order(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.receive_purchase_order(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.receive_purchase_order(uuid) TO authenticated;
