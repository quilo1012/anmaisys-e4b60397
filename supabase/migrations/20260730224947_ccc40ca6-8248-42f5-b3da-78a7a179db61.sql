
DROP POLICY IF EXISTS "authenticated read overrides" ON public.role_permission_overrides;
CREATE POLICY "read own role overrides" ON public.role_permission_overrides
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role::text = role_permission_overrides.role::text
  )
);

DROP POLICY IF EXISTS "role_mobile_hidden read" ON public.role_mobile_hidden;
CREATE POLICY "read own role mobile hidden" ON public.role_mobile_hidden
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role::text = role_mobile_hidden.role::text
  )
);

DROP POLICY IF EXISTS "Authenticated can read sku_line_speeds" ON public.sku_line_speeds;
CREATE POLICY "Operational roles read sku_line_speeds" ON public.sku_line_speeds
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'maintenance_manager'::app_role)
  OR has_role(auth.uid(), 'planner'::app_role)
  OR has_role(auth.uid(), 'production_office_admin'::app_role)
  OR has_role(auth.uid(), 'operator'::app_role)
  OR has_role(auth.uid(), 'warehouse'::app_role)
);
