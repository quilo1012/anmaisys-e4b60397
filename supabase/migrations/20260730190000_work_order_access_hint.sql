-- Why an order will not open: it does not exist, or it is on another line.
--
-- RLS returns "no rows" for both, and the detail page turned that into
-- "Maintenance order not found." A Line 4 operator opening Line 1's WO-607 was told
-- the order did not exist. It does — it simply is not theirs to open, and being told
-- a record is gone when it is not is the kind of thing that gets escalated as data
-- loss.
--
-- Returns the number and the line and nothing else: never the description, the
-- requester, the engineer or any timing. Enough to explain the refusal, not enough
-- to be a way around it.
CREATE OR REPLACE FUNCTION public.work_order_access_hint(_wo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _wo record;
  _line text;
BEGIN
  SELECT w.wo_number, w.line_id, w.line_at_time, w.wo_type INTO _wo
  FROM public.work_orders w WHERE w.id = _wo_id;

  IF _wo.wo_number IS NULL THEN
    RETURN jsonb_build_object('exists', false);
  END IF;

  SELECT name INTO _line FROM public.lines WHERE id = _wo.line_id;

  RETURN jsonb_build_object(
    'exists', true,
    'wo_number', _wo.wo_number,
    'line', COALESCE(_line, NULLIF(_wo.line_at_time, ''), CASE WHEN _wo.wo_type = 'warehouse_service' THEN 'Warehouse' END)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.work_order_access_hint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_order_access_hint(uuid) TO authenticated;

-- Every notification ever written by the iTouching functions pointed at
-- /dashboard/work-orders/<id>, which matches no route — the order's page is
-- /dashboard/wo/<id>. A push already delivered to a phone opened the catch-all
-- instead of the order. 190 rows repaired; the functions now write the real path and
-- App.tsx redirects the old shape for anything still in flight.
UPDATE public.notifications
SET action_url = replace(action_url, '/dashboard/work-orders/', '/dashboard/wo/')
WHERE action_url LIKE '/dashboard/work-orders/%';
