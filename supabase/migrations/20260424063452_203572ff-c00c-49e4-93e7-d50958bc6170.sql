-- Fix work_order_logs RLS to allow logging actions performed via PIN identity (engineers.id)
-- The FK already ensures engineer_id exists in engineers table. RLS just needs to gate by role.

DROP POLICY IF EXISTS "Authenticated can insert work_order_logs" ON public.work_order_logs;

CREATE POLICY "Authenticated can insert work_order_logs"
ON public.work_order_logs
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'engineer'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'operator'::app_role)
);