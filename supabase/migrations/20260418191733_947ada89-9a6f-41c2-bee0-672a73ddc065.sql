-- 1) Restrict wo_messages INSERT to engineer/admin/manager only
DROP POLICY IF EXISTS "Authenticated can insert wo messages" ON public.wo_messages;
CREATE POLICY "Engineers admins managers can insert wo_messages"
  ON public.wo_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'engineer'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
    )
  );

-- 2) Remove manager access to system_settings (admin PIN must be admin-only)
DROP POLICY IF EXISTS "Managers can manage system_settings" ON public.system_settings;

-- 3) Prevent managers from viewing or updating admin profiles
DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Managers can update profiles" ON public.profiles;

CREATE POLICY "Managers can view non-admin profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND NOT public.has_role(id, 'admin'::app_role)
  );

CREATE POLICY "Managers can update non-admin profiles"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND NOT public.has_role(id, 'admin'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'manager'::app_role)
    AND NOT public.has_role(id, 'admin'::app_role)
  );