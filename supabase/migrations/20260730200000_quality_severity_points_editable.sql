-- What a severity is worth stops being a constant in the source.
--
-- Low 1 / Medium 2 / High 3 / Critical 4 was hard-coded in qualityConstants.ts, so
-- changing how quality is weighted meant a developer and a deploy. Quality owns that
-- judgement, not the code.
--
-- Still derived, never stored on the action: severity remains the single source of
-- truth, so re-grading an action cannot leave a stale score behind, and changing a
-- weight re-scores the whole history consistently. That is deliberate — a board that
-- says an action is Critical while its score says otherwise is worse than either.
CREATE TABLE IF NOT EXISTS public.quality_severity_points (
  severity text PRIMARY KEY CHECK (severity IN ('low','medium','high','critical')),
  points integer NOT NULL CHECK (points >= 0 AND points <= 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO public.quality_severity_points (severity, points) VALUES
  ('low', 1), ('medium', 2), ('high', 3), ('critical', 4)
ON CONFLICT (severity) DO NOTHING;

ALTER TABLE public.quality_severity_points ENABLE ROW LEVEL SECURITY;

-- Everyone reads: the weights appear on the board, the log and the leader scorecard,
-- so every role that sees a score needs them.
DROP POLICY IF EXISTS "Anyone signed in can read severity points" ON public.quality_severity_points;
CREATE POLICY "Anyone signed in can read severity points"
ON public.quality_severity_points FOR SELECT TO authenticated USING (true);

-- Only quality and management change them. No INSERT or DELETE policy: the four rows
-- are the four severities, and the check constraint keeps it that way.
DROP POLICY IF EXISTS "Quality and admin can set severity points" ON public.quality_severity_points;
CREATE POLICY "Quality and admin can set severity points"
ON public.quality_severity_points FOR UPDATE TO authenticated
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'quality_supervisor') OR has_role(auth.uid(),'manager'))
WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'quality_supervisor') OR has_role(auth.uid(),'manager'));
