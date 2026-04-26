-- Allow operators on the same line (via operator_line_accounts) to insert/update downtime_events
-- for any work order on their assigned line, not only their own.

DROP POLICY IF EXISTS "dt_insert" ON public.downtime_events;
CREATE POLICY "dt_insert" ON public.downtime_events
FOR INSERT
TO authenticated
WITH CHECK (
  (stopped_by = auth.uid())
  AND (
    has_role(auth.uid(), 'engineer'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (
      has_role(auth.uid(), 'operator'::app_role)
      AND EXISTS (
        SELECT 1 FROM public.work_orders wo
        WHERE wo.id = downtime_events.work_order_id
          AND (
            wo.operator_id = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.operator_line_accounts ola
              WHERE ola.user_id = auth.uid()
                AND wo.line_id = ANY(ola.line_ids)
            )
          )
      )
    )
  )
);

DROP POLICY IF EXISTS "dt_update" ON public.downtime_events;
CREATE POLICY "dt_update" ON public.downtime_events
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'engineer'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_role(auth.uid(), 'operator'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.work_orders wo
      WHERE wo.id = downtime_events.work_order_id
        AND (
          wo.operator_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.operator_line_accounts ola
            WHERE ola.user_id = auth.uid()
              AND wo.line_id = ANY(ola.line_ids)
          )
        )
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'engineer'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_role(auth.uid(), 'operator'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.work_orders wo
      WHERE wo.id = downtime_events.work_order_id
        AND (
          wo.operator_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.operator_line_accounts ola
            WHERE ola.user_id = auth.uid()
              AND wo.line_id = ANY(ola.line_ids)
          )
        )
    )
  )
);