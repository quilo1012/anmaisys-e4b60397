-- Add missing SELECT policy for admins on work_orders
CREATE POLICY "Admins can view all WOs"
ON public.work_orders
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));