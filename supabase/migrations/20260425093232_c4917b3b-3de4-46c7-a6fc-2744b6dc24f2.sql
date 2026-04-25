-- 1) Restrict operator_line_accounts SELECT
DROP POLICY IF EXISTS "Authenticated can view operator_line_accounts" ON public.operator_line_accounts;

CREATE POLICY "Admins managers and owner view operator_line_accounts"
ON public.operator_line_accounts
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR user_id = auth.uid()
);

-- 2) Scope wo_episodes SELECT
DROP POLICY IF EXISTS "wo_episodes_select_auth" ON public.wo_episodes;

CREATE POLICY "wo_episodes_select_scoped"
ON public.wo_episodes
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'engineer'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.work_orders wo
    WHERE wo.id = wo_episodes.work_order_id
      AND (
        wo.operator_id = auth.uid()
        OR wo.engineer_id = auth.uid()
        OR wo.locked_engineer_id = auth.uid()
      )
  )
);