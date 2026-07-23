-- SECURITY (Warning): non-admin roles could read ALL users' audit history via the
-- API. The Audit Logs screen is already admin-only, and no manager/maintenance
-- screen reads audit_logs, so restrict SELECT to admins to match the UI.
DROP POLICY IF EXISTS "Managers can view audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Maintenance managers can view audit logs" ON public.audit_logs;
-- "Admins can view audit logs" remains the only SELECT policy.
