-- Fix 1: Prevent managers from updating admin user roles (privilege escalation)
DROP POLICY IF EXISTS "Managers can update to non-admin roles" ON public.user_roles;

CREATE POLICY "Managers can update to non-admin roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'manager'::app_role) AND role <> 'admin'::app_role)
WITH CHECK (role <> 'admin'::app_role);

-- Fix 2: Remove engineers table from Realtime publication to prevent pin_hash leakage
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'engineers'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.engineers;
  END IF;
END $$;
