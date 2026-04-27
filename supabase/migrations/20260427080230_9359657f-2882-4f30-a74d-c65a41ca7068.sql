ALTER POLICY "Operators strictly scoped to own line"
ON public.work_orders
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR NOT public.has_role(auth.uid(), 'operator'::public.app_role)
  OR operator_id = auth.uid()
  OR (
    line_id IS NOT NULL
    AND line_id = ANY (public.current_device_line_ids())
  )
  OR (
    line_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.operator_line_accounts ola
      WHERE ola.user_id = auth.uid()
        AND work_orders.line_id = ANY (ola.line_ids)
    )
  )
);