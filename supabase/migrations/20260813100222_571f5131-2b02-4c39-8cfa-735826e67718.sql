DROP POLICY IF EXISTS "dt_insert_adjusters" ON public.downtime_events;

CREATE POLICY "dt_insert_adjusters"
ON public.downtime_events
FOR INSERT
TO authenticated
WITH CHECK (
  stopped_by = auth.uid()
  AND public.has_action(
        auth.uid(),
        'downtime.adjust',
        ARRAY['admin','manager','supervisor','maintenance_manager','engineer','co_engineer']::app_role[]
      )
);