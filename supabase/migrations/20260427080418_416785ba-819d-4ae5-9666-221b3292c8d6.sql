-- Recreate the RESTRICTIVE policy so admin/manager/engineer always pass without any extra checks
DROP POLICY IF EXISTS "Operators strictly scoped to own line" ON public.work_orders;

CREATE POLICY "Operators strictly scoped to own line"
ON public.work_orders
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  -- Privileged roles bypass entirely
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'manager'::public.app_role)
  OR public.has_role(auth.uid(), 'engineer'::public.app_role)
  -- Non-operators (e.g. viewers) also bypass this restrictive rule
  OR NOT public.has_role(auth.uid(), 'operator'::public.app_role)
  -- Operator owns the WO
  OR operator_id = auth.uid()
  -- Operator is paired to the WO's line via device
  OR (line_id IS NOT NULL AND line_id = ANY (public.current_device_line_ids()))
  -- Operator is assigned to the WO's line via account
  OR (
    line_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.operator_line_accounts ola
      WHERE ola.user_id = auth.uid()
        AND public.work_orders.line_id = ANY (ola.line_ids)
    )
  )
);