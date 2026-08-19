DROP POLICY IF EXISTS departments_read ON public.departments;
DROP POLICY IF EXISTS departments_write ON public.departments;

CREATE POLICY departments_read ON public.departments
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'production_office_admin'::app_role));

CREATE POLICY departments_write ON public.departments
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.departments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;