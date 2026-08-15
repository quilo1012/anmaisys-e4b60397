-- What a label is worth, alongside what a severity is worth.
--
-- Severity grades a deviation in the abstract. A label says what actually happened,
-- and a foreign body is not a paperwork slip however either one was graded. Quality
-- can now price the label, and when a label carries a price it is the charge — the
-- severity steps aside. See `actionPoints()` in src/lib/qualityConstants.ts, which is
-- the only place that decides it.
--
-- Every row starts at 0, which means "this label does not price the action". So the
-- day this runs, nobody's score moves: an action with no priced label is worth its
-- severity, exactly as before. Pricing is opt-in, one label at a time.
--
-- Derived, never stored on the action — the same rule as quality_severity_points.
-- Re-pricing a label re-scores the history, and no action is left holding a stale
-- number. That is deliberate: a board that says "Foreign Body" while its score says
-- otherwise is worse than either.
ALTER TABLE public.quality_options
  ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 0;

-- The same ceiling as a severity weight, for the same reason: a typo'd 50000 in one
-- box should not silently outrank the entire scoring model.
DO $$ BEGIN
  ALTER TABLE public.quality_options
    ADD CONSTRAINT quality_options_points_range CHECK (points >= 0 AND points <= 1000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Departments are not labels and never price anything. Enforced rather than merely
-- hidden in the UI: the editor only shows the box on labels, but the rule belongs
-- where it cannot be bypassed by whoever writes the next screen.
DO $$ BEGIN
  ALTER TABLE public.quality_options
    ADD CONSTRAINT quality_options_only_labels_are_priced
    CHECK (kind = 'label' OR points = 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.quality_options.points IS
  'What this label charges an action, 0 = unpriced (the action keeps its severity weight). Labels only.';
