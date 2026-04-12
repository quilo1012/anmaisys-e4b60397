
-- Add INSERT policy for engineers on downtime
CREATE POLICY "Engineers can create downtime" ON public.downtime
FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'engineer'::app_role));

-- Add UPDATE policy for engineers on downtime
CREATE POLICY "Engineers can update downtime" ON public.downtime
FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'engineer'::app_role));

-- Add DELETE policy for engineers on downtime
CREATE POLICY "Engineers can delete downtime" ON public.downtime
FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'engineer'::app_role));
