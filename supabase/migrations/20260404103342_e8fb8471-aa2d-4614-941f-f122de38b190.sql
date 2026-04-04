
-- Fix the view to use SECURITY INVOKER
DROP VIEW IF EXISTS public.engineers_safe;

CREATE VIEW public.engineers_safe
WITH (security_invoker = true)
AS
SELECT id, name, is_active, created_at
FROM public.engineers
WHERE is_active = true;

-- Grant access
GRANT SELECT ON public.engineers_safe TO authenticated;

-- Need a SELECT policy for non-admins to read through the view
-- Since the view queries the engineers table, non-admins need a SELECT policy
DROP POLICY IF EXISTS "Admins can view all engineers" ON public.engineers;

-- All authenticated can SELECT (pin_hash is excluded by the view for non-admins)
CREATE POLICY "Authenticated can view engineers"
ON public.engineers
FOR SELECT
TO authenticated
USING (true);
