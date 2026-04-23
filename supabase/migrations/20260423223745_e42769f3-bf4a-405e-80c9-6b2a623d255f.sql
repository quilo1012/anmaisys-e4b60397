CREATE OR REPLACE VIEW public.engineers_safe
WITH (security_invoker=on) AS
SELECT id, name, is_active, created_at
FROM public.engineers;

DROP POLICY IF EXISTS "Managers can view engineers (safe view only)" ON public.engineers;
DROP POLICY IF EXISTS "Admins can manage engineers" ON public.engineers;

CREATE POLICY "Admins can manage engineers"
ON public.engineers
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Managers can manage engineers"
ON public.engineers
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'manager'::public.app_role));

CREATE POLICY "No direct engineer reads for authenticated users"
ON public.engineers
FOR SELECT
TO authenticated
USING (false);

GRANT SELECT ON public.engineers_safe TO authenticated;