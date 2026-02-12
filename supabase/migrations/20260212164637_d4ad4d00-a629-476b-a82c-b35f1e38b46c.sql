
-- Allow engineers to see other engineer profiles (for online panel)
CREATE POLICY "Engineers can view engineer profiles"
ON public.profiles FOR SELECT
USING (
  has_role(auth.uid(), 'engineer'::app_role)
  AND has_role(id, 'engineer'::app_role)
);
