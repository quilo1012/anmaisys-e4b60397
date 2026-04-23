DROP POLICY IF EXISTS "Admins can manage engineers" ON public.engineers;
DROP POLICY IF EXISTS "Managers can manage engineers" ON public.engineers;
DROP POLICY IF EXISTS "No direct engineer reads for authenticated users" ON public.engineers;

CREATE POLICY "Admins can create engineers"
ON public.engineers
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update engineers"
ON public.engineers
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete engineers"
ON public.engineers
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Managers can create engineers"
ON public.engineers
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'manager'::public.app_role));

CREATE POLICY "Managers can update engineers"
ON public.engineers
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'manager'::public.app_role));

CREATE POLICY "Managers can delete engineers"
ON public.engineers
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'manager'::public.app_role));

CREATE POLICY "No direct engineer reads for authenticated users"
ON public.engineers
FOR SELECT
TO authenticated
USING (false);