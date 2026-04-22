-- Allow managers to view engineers (needed for engineers_safe view via security_invoker)
CREATE POLICY "Managers can view engineers"
ON public.engineers
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'manager'::app_role));