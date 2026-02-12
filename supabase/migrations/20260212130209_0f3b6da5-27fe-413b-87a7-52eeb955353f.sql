CREATE TABLE public.problem_descriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.problem_descriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage problem_descriptions"
  ON public.problem_descriptions FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can view problem_descriptions"
  ON public.problem_descriptions FOR SELECT
  USING (
    has_role(auth.uid(), 'operator'::app_role) OR
    has_role(auth.uid(), 'engineer'::app_role) OR
    has_role(auth.uid(), 'admin'::app_role)
  );