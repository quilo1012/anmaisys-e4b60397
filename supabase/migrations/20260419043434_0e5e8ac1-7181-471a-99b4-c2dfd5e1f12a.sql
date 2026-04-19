-- Drop any DELETE policies on audit_logs
DROP POLICY IF EXISTS "Admins can delete audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_delete_admin ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_delete_all ON public.audit_logs;

-- Drop direct INSERT policy (inserts must go through log_audit_event SECURITY DEFINER function)
DROP POLICY IF EXISTS "Authenticated can insert own audit logs" ON public.audit_logs;

-- Revoke table-level grants from authenticated role
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;
-- log_audit_event is SECURITY DEFINER so it continues to work as the function owner.
