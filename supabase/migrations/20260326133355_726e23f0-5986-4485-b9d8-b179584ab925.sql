
-- Add DELETE policy on audit_logs for admin
CREATE POLICY "Admins can delete audit logs"
ON public.audit_logs
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Reset wo_number sequence
ALTER SEQUENCE wo_number_seq RESTART WITH 1;
