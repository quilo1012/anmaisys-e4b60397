DROP POLICY IF EXISTS "wo_episodes_insert_auth" ON public.wo_episodes;
DROP POLICY IF EXISTS "wo_episodes_update_auth" ON public.wo_episodes;

CREATE POLICY "wo_episodes_insert_roles"
  ON public.wo_episodes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'operator'::app_role)
  );

CREATE POLICY "wo_episodes_update_roles"
  ON public.wo_episodes FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
  );