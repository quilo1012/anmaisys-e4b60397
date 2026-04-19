-- 1. Restrict downtime_events SELECT
DROP POLICY IF EXISTS "dt_select" ON public.downtime_events;

CREATE POLICY "Scoped downtime_events select"
ON public.downtime_events
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'engineer'::app_role)
  OR stopped_by = auth.uid()
  OR resumed_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.work_orders wo
    WHERE wo.id = downtime_events.work_order_id
      AND wo.operator_id = auth.uid()
  )
);

-- 2. Allow managers to view non-admin profiles
CREATE POLICY "Managers can view non-admin profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND NOT has_role(id, 'admin'::app_role)
);