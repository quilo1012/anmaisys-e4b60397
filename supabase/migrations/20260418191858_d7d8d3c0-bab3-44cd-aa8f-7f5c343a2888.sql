-- 1) recurrence link on work_orders
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS recurrence_of_wo_id UUID
    REFERENCES public.work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wo_recurrence
  ON public.work_orders(recurrence_of_wo_id)
  WHERE recurrence_of_wo_id IS NOT NULL;

-- 2) is_recurrence flag on downtime events
ALTER TABLE public.downtime_events
  ADD COLUMN IF NOT EXISTS is_recurrence BOOLEAN NOT NULL DEFAULT false;

-- 3) Allow operators (and their existing roles) to insert downtime events
--    on work orders they own so they can report "line stopped again".
DROP POLICY IF EXISTS "dt_insert" ON public.downtime_events;
CREATE POLICY "dt_insert"
  ON public.downtime_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    stopped_by = auth.uid()
    AND (
      public.has_role(auth.uid(), 'engineer'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR (
        public.has_role(auth.uid(), 'operator'::app_role)
        AND EXISTS (
          SELECT 1 FROM public.work_orders wo
          WHERE wo.id = work_order_id
            AND wo.operator_id = auth.uid()
        )
      )
    )
  );