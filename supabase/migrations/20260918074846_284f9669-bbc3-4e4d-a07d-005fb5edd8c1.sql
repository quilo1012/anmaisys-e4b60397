-- Target history: the line plan is not the only place a target moves. SKU-level
-- edits log as update_target_qty on production_item and feed the line plan
-- through sync_items_target_from_rag, so the panel must show both or it lies by
-- omission. Still SECURITY DEFINER, still nothing but these two actions.
DROP FUNCTION IF EXISTS public.rag_plan_history(uuid[]);

CREATE FUNCTION public.rag_plan_history(_entry_ids uuid[])
RETURNS TABLE (
  entry_id uuid,
  changed_at timestamptz,
  user_name text,
  before_qty numeric,
  after_qty numeric,
  kind text,
  sku_code text,
  sku_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Line/shift plan changes, keyed straight off the audited row id.
  SELECT
    (a.entity_id)::uuid                       AS entry_id,
    a.created_at                              AS changed_at,
    a.user_name                               AS user_name,
    NULLIF(a.details->>'before', '')::numeric AS before_qty,
    NULLIF(a.details->>'after', '')::numeric  AS after_qty,
    'line'::text                              AS kind,
    NULL::text                                AS sku_code,
    NULL::text                                AS sku_name
  FROM public.audit_logs a
  WHERE auth.uid() IS NOT NULL
    AND a.action = 'update_rag_plan_qty'
    AND a.entity_type = 'rag_weekly_entry'
    AND a.entity_id IS NOT NULL
    AND a.entity_id ~ '^[0-9a-fA-F-]{36}$'
    AND (a.entity_id)::uuid = ANY (COALESCE(_entry_ids, ARRAY[]::uuid[]))

  UNION ALL

  -- SKU-level target changes, matched to the cell by date, line and shift.
  SELECT
    e.id,
    a.created_at,
    a.user_name,
    NULLIF(a.details->>'before', '')::numeric,
    NULLIF(a.details->>'after', '')::numeric,
    'sku'::text,
    a.details->>'sku_code',
    a.details->>'sku_name'
  FROM public.audit_logs a
  JOIN public.rag_weekly_entries e
    ON e.id = ANY (COALESCE(_entry_ids, ARRAY[]::uuid[]))
   AND e.entry_date = (a.details->>'session_date')::date
   AND e.line = a.details->>'line'
   AND e.shift = a.details->>'shift'
  WHERE auth.uid() IS NOT NULL
    AND a.action = 'update_target_qty'
    AND a.entity_type = 'production_item'
    AND a.details ? 'session_date'
    AND a.details->>'session_date' ~ '^\d{4}-\d{2}-\d{2}$'
    AND a.details ? 'line'
    AND a.details ? 'shift'

  ORDER BY changed_at DESC
$function$;

REVOKE ALL ON FUNCTION public.rag_plan_history(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rag_plan_history(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.rag_plan_history(uuid[]) TO authenticated;

-- The workbook carries the UPM target too. Only plan_qty and upm_target: the
-- measured columns still belong to this system, not to the spreadsheet.
CREATE OR REPLACE FUNCTION public.import_rag_plan_workbook(
  _updates jsonb DEFAULT '[]'::jsonb,
  _inserts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  _updated integer := 0;
  _created integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(_updates, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(_inserts, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'import_rag_plan_workbook expects two JSON arrays';
  END IF;

  -- A NULL upm_target in the payload means "the file had nothing there" and the
  -- stored value is kept. The DISTINCT FROM guard keeps the count honest and
  -- stops the audit trigger firing for rows that did not actually move.
  UPDATE public.rag_weekly_entries e
     SET plan_qty   = COALESCE(v.plan_qty, e.plan_qty),
         upm_target = COALESCE(v.upm_target, e.upm_target)
    FROM jsonb_to_recordset(COALESCE(_updates, '[]'::jsonb))
      AS v(id uuid, plan_qty numeric, upm_target numeric)
   WHERE e.id = v.id
     AND (
       e.plan_qty IS DISTINCT FROM COALESCE(v.plan_qty, e.plan_qty)
       OR e.upm_target IS DISTINCT FROM COALESCE(v.upm_target, e.upm_target)
     );
  GET DIAGNOSTICS _updated = ROW_COUNT;

  INSERT INTO public.rag_weekly_entries (entry_date, line, shift, plan_qty, upm_target, created_by)
  SELECT n.entry_date, n.line, n.shift, n.plan_qty, COALESCE(n.upm_target, 0), auth.uid()
    FROM jsonb_to_recordset(COALESCE(_inserts, '[]'::jsonb))
      AS n(entry_date date, line text, shift text, plan_qty numeric, upm_target numeric)
   ON CONFLICT (entry_date, line, shift) DO NOTHING;
  GET DIAGNOSTICS _created = ROW_COUNT;

  RETURN jsonb_build_object('updated', _updated, 'created', _created);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';