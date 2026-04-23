-- Remove manager direct SELECT/INSERT/UPDATE/DELETE on engineers table to prevent
-- exposure of pin_hash. Managers will continue to:
--   * read engineers via the engineers_safe view (no pin_hash column)
--   * create/update/delete engineers via service-role edge functions
--     (list-engineers, create-engineer, update-engineer, delete-engineer)
-- Admins retain full ALL access.

DROP POLICY IF EXISTS "Managers can view engineers" ON public.engineers;
DROP POLICY IF EXISTS "Managers can insert engineers" ON public.engineers;
DROP POLICY IF EXISTS "Managers can update engineers" ON public.engineers;
DROP POLICY IF EXISTS "Managers can delete engineers" ON public.engineers;

-- Ensure engineers_safe view is readable by managers (and other authenticated users
-- already covered). Views inherit the invoker permissions; grant SELECT explicitly.
GRANT SELECT ON public.engineers_safe TO authenticated;