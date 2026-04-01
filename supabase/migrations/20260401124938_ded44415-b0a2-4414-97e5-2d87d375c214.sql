
-- Drop overly permissive policies
DROP POLICY "Authenticated can insert checklist_responses" ON public.checklist_responses;
DROP POLICY "Authenticated can update checklist_responses" ON public.checklist_responses;

-- Recreate with proper restrictions
CREATE POLICY "Engineers and admins can insert checklist_responses"
  ON public.checklist_responses FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Engineers and admins can update checklist_responses"
  ON public.checklist_responses FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'engineer'::app_role) OR has_role(auth.uid(), 'admin'::app_role));
