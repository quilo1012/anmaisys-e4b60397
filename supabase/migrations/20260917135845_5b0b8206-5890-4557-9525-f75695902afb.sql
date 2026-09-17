CREATE OR REPLACE FUNCTION public.distinct_rag_lines()
RETURNS TABLE(line text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT e.line FROM public.rag_weekly_entries e ORDER BY 1
$$;

REVOKE ALL ON FUNCTION public.distinct_rag_lines() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.distinct_rag_lines() TO authenticated;
GRANT EXECUTE ON FUNCTION public.distinct_rag_lines() TO service_role;