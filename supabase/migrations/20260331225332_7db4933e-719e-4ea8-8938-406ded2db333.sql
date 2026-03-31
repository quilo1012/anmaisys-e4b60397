
DROP POLICY "Authenticated can insert work_order_logs" ON public.work_order_logs;
CREATE POLICY "Authenticated can insert work_order_logs"
  ON public.work_order_logs FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
  );
