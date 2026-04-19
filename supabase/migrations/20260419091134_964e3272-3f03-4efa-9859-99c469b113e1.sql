DROP VIEW IF EXISTS public.profiles_safe CASCADE;
DROP VIEW IF EXISTS public.engineers_safe CASCADE;

CREATE VIEW public.profiles_safe
WITH (security_invoker = true) AS
SELECT id, name, email, active, shift, created_at, updated_at,
       last_seen_at, labor_rate, ui_preferences
FROM public.profiles;

CREATE VIEW public.engineers_safe
WITH (security_invoker = true) AS
SELECT id, name, is_active, created_at
FROM public.engineers;

GRANT SELECT ON public.profiles_safe TO authenticated;
GRANT SELECT ON public.engineers_safe TO authenticated;

DROP POLICY IF EXISTS "Managers can view non-admin profiles" ON public.profiles;

DROP POLICY IF EXISTS "Admins and managers can view all engineers" ON public.engineers;
CREATE POLICY "Admins can view all engineers"
ON public.engineers
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view audit logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Managers can update to limited roles" ON public.user_roles;
CREATE POLICY "Managers can update to limited roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND role = ANY (ARRAY['engineer'::app_role, 'operator'::app_role, 'viewer'::app_role])
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND role = ANY (ARRAY['engineer'::app_role, 'operator'::app_role, 'viewer'::app_role])
);