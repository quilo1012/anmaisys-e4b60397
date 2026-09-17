CREATE OR REPLACE FUNCTION public.import_rag_plan_workbook(
  _updates jsonb DEFAULT '[]'::jsonb,
  _inserts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _updated integer := 0;
  _created integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(_updates, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(_inserts, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'import_rag_plan_workbook expects two JSON arrays';
  END IF;

  UPDATE public.rag_weekly_entries e
     SET plan_qty = v.plan_qty
    FROM jsonb_to_recordset(COALESCE(_updates, '[]'::jsonb)) AS v(id uuid, plan_qty numeric)
   WHERE e.id = v.id
     AND e.plan_qty IS DISTINCT FROM v.plan_qty;
  GET DIAGNOSTICS _updated = ROW_COUNT;

  INSERT INTO public.rag_weekly_entries (entry_date, line, shift, plan_qty, created_by)
  SELECT n.entry_date, n.line, n.shift, n.plan_qty, auth.uid()
    FROM jsonb_to_recordset(COALESCE(_inserts, '[]'::jsonb))
      AS n(entry_date date, line text, shift text, plan_qty numeric)
   ON CONFLICT (entry_date, line, shift) DO NOTHING;
  GET DIAGNOSTICS _created = ROW_COUNT;

  RETURN jsonb_build_object('updated', _updated, 'created', _created);
END;
$$;

REVOKE ALL ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';