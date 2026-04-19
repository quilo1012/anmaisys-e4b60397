-- 1. wo_pauses: tighten RLS to scope to the locked engineer of the WO
DROP POLICY IF EXISTS "wo_pauses_insert_roles" ON public.wo_pauses;
DROP POLICY IF EXISTS "wo_pauses_select_auth" ON public.wo_pauses;
DROP POLICY IF EXISTS "wo_pauses_update_roles" ON public.wo_pauses;

CREATE POLICY "wo_pauses_select_scoped"
ON public.wo_pauses
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.work_orders wo
    WHERE wo.id = wo_pauses.wo_id
      AND (wo.locked_engineer_id = auth.uid() OR wo.operator_id = auth.uid())
  )
);

CREATE POLICY "wo_pauses_insert_scoped"
ON public.wo_pauses
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.work_orders wo
    WHERE wo.id = wo_pauses.wo_id
      AND wo.locked_engineer_id = auth.uid()
  )
);

CREATE POLICY "wo_pauses_update_scoped"
ON public.wo_pauses
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.work_orders wo
    WHERE wo.id = wo_pauses.wo_id
      AND wo.locked_engineer_id = auth.uid()
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.work_orders wo
    WHERE wo.id = wo_pauses.wo_id
      AND wo.locked_engineer_id = auth.uid()
  )
);

-- 2. v_wo_metrics: ensure security_invoker + grant to authenticated
ALTER VIEW public.v_wo_metrics SET (security_invoker = true);
GRANT SELECT ON public.v_wo_metrics TO authenticated;

-- 3. Deprecate legacy downtime table
COMMENT ON TABLE public.downtime IS 'DEPRECATED — use downtime_events. Kept for historical data.';