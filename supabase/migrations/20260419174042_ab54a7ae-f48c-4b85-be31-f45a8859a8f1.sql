-- 1. Restrict pin_hash exposure: revoke column-level SELECT from authenticated
REVOKE SELECT (pin_hash) ON public.engineers FROM authenticated;
REVOKE SELECT (pin_hash) ON public.engineers FROM anon;

-- 2. Prevent managers from assigning roles to themselves
DROP POLICY IF EXISTS "Managers can insert limited roles" ON public.user_roles;
CREATE POLICY "Managers can insert limited roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND user_id <> auth.uid()
  AND role = ANY (ARRAY['engineer'::app_role, 'operator'::app_role, 'viewer'::app_role])
);

DROP POLICY IF EXISTS "Managers can update to limited roles" ON public.user_roles;
CREATE POLICY "Managers can update to limited roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND user_id <> auth.uid()
  AND role = ANY (ARRAY['engineer'::app_role, 'operator'::app_role, 'viewer'::app_role])
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND user_id <> auth.uid()
  AND role = ANY (ARRAY['engineer'::app_role, 'operator'::app_role, 'viewer'::app_role])
);

-- 3. Allow operators to receive Realtime broadcasts (they need live updates on their own WOs)
DROP POLICY IF EXISTS "Authenticated roles receive realtime" ON realtime.messages;
CREATE POLICY "Authenticated roles receive realtime"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'engineer'::app_role)
  OR has_role(auth.uid(), 'operator'::app_role)
);