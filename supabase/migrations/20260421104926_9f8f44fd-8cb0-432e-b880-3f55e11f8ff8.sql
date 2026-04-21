-- Junction table: which problems are available on which line
CREATE TABLE public.line_problem_descriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  line_id UUID NOT NULL REFERENCES public.lines(id) ON DELETE CASCADE,
  problem_description_id UUID NOT NULL REFERENCES public.problem_descriptions(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (line_id, problem_description_id)
);

CREATE INDEX idx_lpd_line_id ON public.line_problem_descriptions(line_id);
CREATE INDEX idx_lpd_problem_id ON public.line_problem_descriptions(problem_description_id);

ALTER TABLE public.line_problem_descriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view line_problem_descriptions"
  ON public.line_problem_descriptions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage line_problem_descriptions"
  ON public.line_problem_descriptions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage line_problem_descriptions"
  ON public.line_problem_descriptions FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'manager'::app_role));