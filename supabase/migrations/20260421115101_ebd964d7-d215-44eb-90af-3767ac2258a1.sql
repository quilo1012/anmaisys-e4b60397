DROP POLICY IF EXISTS "Operators view WOs scoped by device line" ON public.work_orders;

CREATE POLICY "Operators can view own WOs"
  ON public.work_orders FOR SELECT
  TO authenticated
  USING (
    operator_id = auth.uid()
    OR has_role(auth.uid(), 'engineer'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  );
