-- The Quality screen was stating things nobody had checked.
--
-- "Line 4 — Rafael Tosta — 06/09/2026" reads as a settled fact, and three separate
-- claims are folded into it: that the finding was raised inside Production, that the
-- 6th is the day it was RAISED rather than the day it falls due, and that Rafael was
-- on Line 4 that day. The importer verified none of the three.
--
-- The first is measurable right now: of the forty-nine records imported from
-- SafetyCulture, fifteen came from somewhere other than Production — nine of them from
-- site "External" — and every one of them was counted as an operational action.
--
-- These columns give a record somewhere to say what was checked and what was found, so
-- the screen can stop presenting an inference as an observation. The verdict itself is
-- computed in `_shared/safetyculture/classification.ts` and written by the classify
-- function; the only thing decided in SQL is the one-off backfill at the bottom, which
-- closes the site hole immediately rather than waiting for a deploy.

-- ── The verdict, and the evidence behind it ────────────────────────────────────────
ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS classification text
    CHECK (classification IS NULL OR classification IN
      ('line','leader','quality_error','needs_review','excluded')),
  ADD COLUMN IF NOT EXISTS classification_checks jsonb,
  ADD COLUMN IF NOT EXISTS classification_reasons text[],
  ADD COLUMN IF NOT EXISTS matched_rule_ids uuid[],
  ADD COLUMN IF NOT EXISTS matched_rule_names text[],
  ADD COLUMN IF NOT EXISTS classified_at timestamptz;

COMMENT ON COLUMN public.quality_actions.classification IS
  'What the record is, once the gates have run: line, leader, quality_error, '
  'needs_review, or excluded (raised outside Production). NULL means it has not been '
  'classified yet — not that it passed.';

COMMENT ON COLUMN public.quality_actions.classification_checks IS
  'One state per gate: {"site","action_date","worker","line"} each ok | failed | '
  'unknown. `unknown` is deliberately not `failed`: employee_attendance is sparse, so '
  '"no row for that day" and "a row saying absent" are different statements and only '
  'the second one blocks.';

COMMENT ON COLUMN public.quality_actions.matched_rule_names IS
  'Denormalised on purpose. A rule can be renamed or deleted after it classified a '
  'record, and the drawer still has to be able to say what decided this row.';

-- The operational screen reads by class and date, and only ever for imported rows.
CREATE INDEX IF NOT EXISTS quality_actions_classification_idx
  ON public.quality_actions (classification, recorded_at DESC)
  WHERE source = 'safetyculture';

-- ── Rules gain a name and a verdict of their own ───────────────────────────────────
-- Until now a rule could say which line or which error type an action was about, but
-- not what the action IS. Without that there is nothing for two rules to disagree
-- about, and a conflict that cannot be expressed cannot be caught.
ALTER TABLE public.sc_classification_rules
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS classification text
    CHECK (classification IS NULL OR classification IN ('line','leader','quality_error'));

COMMENT ON COLUMN public.sc_classification_rules.classification IS
  'What a match asserts. NULL means the rule only tags (line, error type, department) '
  'and leaves the verdict to the default reading. Two matching rules that name '
  'DIFFERENT classes are a conflict: the record goes to review rather than the higher '
  'priority silently winning, because priority is an ordering, not an arbitrator.';

-- Every rule needs something to show in "Matched Rule". The existing sixty-three were
-- written before the column existed, so they are named after what they already do.
UPDATE public.sc_classification_rules
SET name = COALESCE(
  NULLIF(error_type, ''),
  NULLIF(department, ''),
  NULLIF(line_name, ''),
  match_field || ' ~ ' || left(match_value, 40)
)
WHERE name IS NULL OR name = '';

-- ── The one thing that is safe to decide here ──────────────────────────────────────
-- Site is a plain string comparison with no evidence to weigh, so the backfill cannot
-- drift from the TypeScript. Everything else is left NULL for the classify pass.
--
-- Note the two cases are NOT the same. A record raised at another site is excluded; a
-- record with no site at all is sent to a human, because dropping a row from the
-- operational view on the strength of an ABSENT field hides it from everybody.
UPDATE public.quality_actions
SET classification = 'excluded',
    classification_checks = jsonb_build_object(
      'site','failed','action_date','unknown','worker','unknown','line','unknown'),
    classification_reasons = ARRAY['site_not_production'],
    classified_at = now()
WHERE source = 'safetyculture'
  AND classification IS NULL
  AND external_site IS NOT NULL
  AND btrim(lower(external_site)) <> 'production';

UPDATE public.quality_actions
SET classification = 'needs_review',
    classification_checks = jsonb_build_object(
      'site','unknown','action_date','unknown','worker','unknown','line','unknown'),
    classification_reasons = ARRAY['site_missing'],
    classified_at = now()
WHERE source = 'safetyculture'
  AND classification IS NULL
  AND (external_site IS NULL OR btrim(external_site) = '');
