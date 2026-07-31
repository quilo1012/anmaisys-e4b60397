-- An action raised on a line is not automatically the leader's doing.
--
-- A machine failure is maintenance's. A GMP finding is raised against the line, not
-- against the person running it that night. Charging those to the leader's score makes
-- the score measure who was unlucky rather than who did the job — and a leader who
-- learns that is a leader who stops raising actions.
--
-- Which labels belong to whom is the factory's judgement and it will change, so it is
-- a table rather than a list in the code. Anything NOT listed counts: a new label has
-- to be excluded on purpose, so nothing quietly stops counting.
CREATE TABLE IF NOT EXISTS public.quality_label_attribution (
  label text PRIMARY KEY,
  counts_against_leader boolean NOT NULL DEFAULT true,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.quality_label_attribution (label, counts_against_leader, note) VALUES
  ('Maintenance', false, 'A machine failure is not the shift leader''s doing.'),
  ('GMP', false, 'Raised against the line, not against the person running it.')
ON CONFLICT (label) DO NOTHING;

ALTER TABLE public.quality_label_attribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "label attribution read" ON public.quality_label_attribution;
CREATE POLICY "label attribution read" ON public.quality_label_attribution
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- Quality owns this alongside the severity weights: it decides what a deviation is,
-- so it decides whose deviation it is.
DROP POLICY IF EXISTS "label attribution write" ON public.quality_label_attribution;
CREATE POLICY "label attribution write" ON public.quality_label_attribution
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'quality_supervisor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'quality_supervisor'::app_role));
