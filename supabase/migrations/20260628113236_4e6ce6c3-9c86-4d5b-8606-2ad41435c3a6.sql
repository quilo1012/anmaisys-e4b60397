-- Restore the safe public tablet selector used before authentication.
-- This function intentionally returns only non-sensitive fields needed on /login.
CREATE OR REPLACE FUNCTION public.list_tablet_accounts_public()
RETURNS TABLE(id uuid, label text, line_ids uuid[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.label, o.line_ids
  FROM public.operator_line_accounts o
  WHERE COALESCE(o.active, true) = true
  ORDER BY o.label ASC
$$;

REVOKE ALL ON FUNCTION public.list_tablet_accounts_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_tablet_accounts_public() TO anon, authenticated, service_role;