-- ================================================================
-- 20260817090000_safety_shares_the_log_but_not_the_score
-- ================================================================
-- Safety shares the log, but not the score.
--
-- A safety occurrence has the same life as a quality one — recorded, owned, validated,
-- closed, with attachments — so it gets the same table rather than a parallel one that
-- would duplicate the validation and closure machinery and then rot beside it.
--
-- What must NOT be shared is the arithmetic. The quality module charges points to a
-- leader: more actions recorded, worse. Safety runs the other way — reporting a near
-- miss is the behaviour we want, and zero reported means under-reporting rather than a
-- safe line. Wire the two into one score and logging a near miss would penalise the
-- leader who logged it, which teaches the whole team not to log them. So the score is
-- switched off for this domain, in exactly one place: `actionPoints()` in
-- src/lib/qualityConstants.ts.

DO $$ BEGIN
  CREATE TYPE public.action_domain AS ENUM ('quality', 'safety');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.safety_kind AS ENUM (
    'lost_time_injury', 'reportable_accident', 'first_aid', 'near_miss',
    'safety_observation', 'toolbox_talk', 'ppe_breach');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS domain public.action_domain NOT NULL DEFAULT 'quality',
  ADD COLUMN IF NOT EXISTS safety_kind public.safety_kind;

-- Both contradictions are refused: a safety row nobody classified, and a quality row
-- carrying a safety type. Either one would reach the weekly counts as a silent wrong
-- answer rather than an error.
DO $$ BEGIN
  ALTER TABLE public.quality_actions
    ADD CONSTRAINT quality_actions_safety_kind_matches_domain
    CHECK ((domain = 'safety') = (safety_kind IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS quality_actions_domain_idx
  ON public.quality_actions (domain, recorded_at DESC);
-- The weekly counts group by leader, line and week within one domain.
CREATE INDEX IF NOT EXISTS quality_actions_safety_counts_idx
  ON public.quality_actions (domain, leader_id, line, recorded_at)
  WHERE domain = 'safety';

COMMENT ON COLUMN public.quality_actions.domain IS
  'Quality or safety. Every row that existed before this column is quality, which is what the default says. Safety rows are counted, never scored: see actionPoints() in src/lib/qualityConstants.ts.';
COMMENT ON COLUMN public.quality_actions.safety_kind IS
  'What kind of safety occurrence. first_aid and near_miss are DIFFERENT THINGS and must never be summed: the first is a consequence, the second is a leading signal, and a near miss reported is a good outcome.';

