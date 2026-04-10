-- Add INSERT policy on audit_logs for authenticated users (safety net alongside SECURITY DEFINER function)
CREATE POLICY "Authenticated can insert audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (true);
