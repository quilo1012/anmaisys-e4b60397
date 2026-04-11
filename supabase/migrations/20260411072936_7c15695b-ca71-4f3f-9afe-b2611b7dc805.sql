
-- 1. Fix engineers table: remove permissive SELECT, restrict to admins/managers only
DROP POLICY IF EXISTS "Authenticated can view engineers" ON public.engineers;

CREATE POLICY "Admins and managers can view all engineers"
ON public.engineers
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
);

-- Engineers/operators should use the engineers_safe view (no pin_hash)
-- Add a policy so engineers can view via direct table for FK resolution if needed
CREATE POLICY "Engineers can view own engineer record"
ON public.engineers
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'engineer'::app_role) AND id = auth.uid()
);

-- 2. Fix user_roles: prevent managers from assigning admin role
DROP POLICY IF EXISTS "Managers can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Managers can update roles" ON public.user_roles;

CREATE POLICY "Managers can insert non-admin roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role) AND role != 'admin'::app_role
);

CREATE POLICY "Managers can update to non-admin roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'manager'::app_role))
WITH CHECK (role != 'admin'::app_role);

-- 3. Fix audit_logs: restrict INSERT so user_id must match auth.uid()
DROP POLICY IF EXISTS "Authenticated can insert audit logs" ON public.audit_logs;

CREATE POLICY "Authenticated can insert own audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());
