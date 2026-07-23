-- Allow QC Supervisor (and Supervisor) to DELETE quality actions.
-- Previously DELETE was restricted to admin/manager only, while INSERT/UPDATE
-- already allowed supervisor + quality_supervisor. This aligns DELETE with them
-- so the QC Supervisor can edit AND remove actions (validated in the backend).

DROP POLICY IF EXISTS "quality_actions delete admin/manager" ON public.quality_actions;

CREATE POLICY "quality_actions delete quality staff"
  ON public.quality_actions
  FOR DELETE
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR
    has_role(auth.uid(), 'manager'::app_role) OR
    has_role(auth.uid(), 'supervisor'::app_role) OR
    has_role(auth.uid(), 'quality_supervisor'::app_role)
  );
