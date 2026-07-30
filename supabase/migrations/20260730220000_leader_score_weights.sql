-- How the leader's final score is weighted.
--
-- The BRD asks for Final = Production + Quality + Documentation. What it does not
-- say — and should not — is how much each is worth: that is a management judgement
-- about how this factory is run, and hard-coding a number would have made it mine.
--
-- One row, three percentages, and a constraint that they total 100 so a half-finished
-- edit cannot leave every leader's score quietly rescaled. The defaults are a
-- starting point to be argued with, not a recommendation.
CREATE TABLE IF NOT EXISTS public.leader_score_weights (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  production_pct integer NOT NULL DEFAULT 40 CHECK (production_pct BETWEEN 0 AND 100),
  quality_pct integer NOT NULL DEFAULT 30 CHECK (quality_pct BETWEEN 0 AND 100),
  documentation_pct integer NOT NULL DEFAULT 30 CHECK (documentation_pct BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT weights_sum_100 CHECK (production_pct + quality_pct + documentation_pct = 100)
);

INSERT INTO public.leader_score_weights (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.leader_score_weights ENABLE ROW LEVEL SECURITY;

-- Everyone reads: the weights are printed beside the score on the scorecard, because
-- a leader has to be able to check the number that is about them.
DROP POLICY IF EXISTS "Anyone signed in reads leader score weights" ON public.leader_score_weights;
CREATE POLICY "Anyone signed in reads leader score weights"
ON public.leader_score_weights FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Quality and management set leader score weights" ON public.leader_score_weights;
CREATE POLICY "Quality and management set leader score weights"
ON public.leader_score_weights FOR UPDATE TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'quality_supervisor'))
WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'quality_supervisor'));
