DROP POLICY IF EXISTS "Anplanner leaders can create WOs" ON public.work_orders;
CREATE POLICY "Anplanner leaders can create WOs"
  ON public.work_orders FOR INSERT TO authenticated
  WITH CHECK (
    operator_id = auth.uid()
    AND public.has_role(auth.uid(), 'operator'::public.app_role)
  );

DROP POLICY IF EXISTS "Anplanner leaders can view their own WOs" ON public.work_orders;
CREATE POLICY "Anplanner leaders can view their own WOs"
  ON public.work_orders FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'operator'::public.app_role)
    AND operator_id = auth.uid()
  );