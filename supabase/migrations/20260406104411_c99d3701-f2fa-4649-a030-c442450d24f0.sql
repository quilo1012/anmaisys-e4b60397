DROP POLICY "Engineers can insert parts used" ON public.parts_used;
CREATE POLICY "Engineers and admins can insert parts used"
  ON public.parts_used FOR INSERT
  WITH CHECK (
    engineer_id = auth.uid() AND (
      has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role)
    )
  );