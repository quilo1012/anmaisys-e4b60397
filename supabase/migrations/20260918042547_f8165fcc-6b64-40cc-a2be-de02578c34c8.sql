CREATE OR REPLACE FUNCTION public.rag_plan_history(_entry_ids uuid[])
RETURNS TABLE (
  entry_id uuid,
  changed_at timestamptz,
  user_name text,
  before_qty numeric,
  after_qty numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Same condition as the rag_weekly_select_auth policy on rag_weekly_entries:
  -- any signed-in user who can read the board can read its plan history.
  SELECT
    (a.entity_id)::uuid                       AS entry_id,
    a.created_at                              AS changed_at,
    a.user_name                               AS user_name,
    NULLIF(a.details->>'before', '')::numeric  AS before_qty,
    NULLIF(a.details->>'after', '')::numeric   AS after_qty
  FROM public.audit_logs a
  WHERE auth.uid() IS NOT NULL
    AND a.action = 'update_rag_plan_qty'
    AND a.entity_type = 'rag_weekly_entry'
    AND a.entity_id IS NOT NULL
    AND a.entity_id ~ '^[0-9a-fA-F-]{36}$'
    AND (a.entity_id)::uuid = ANY (COALESCE(_entry_ids, ARRAY[]::uuid[]))
  ORDER BY a.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.rag_plan_history(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rag_plan_history(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.rag_plan_history(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';