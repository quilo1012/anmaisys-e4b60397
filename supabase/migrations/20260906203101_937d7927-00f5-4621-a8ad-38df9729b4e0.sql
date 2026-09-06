ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS external_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_site text,
  ADD COLUMN IF NOT EXISTS external_asset text,
  ADD COLUMN IF NOT EXISTS external_template text,
  ADD COLUMN IF NOT EXISTS external_assignees text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'needs_review';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quality_actions_classification_status_check'
  ) THEN
    ALTER TABLE public.quality_actions
      ADD CONSTRAINT quality_actions_classification_status_check
      CHECK (classification_status IN ('classified','needs_review'));
  END IF;
END $$;

UPDATE public.quality_actions
   SET classification_status = CASE WHEN needs_classification THEN 'needs_review' ELSE 'classified' END
 WHERE source = 'safetyculture';

UPDATE public.quality_actions
   SET classification_status = 'classified'
 WHERE source IS DISTINCT FROM 'safetyculture';

ALTER TABLE public.sc_sync_state
  ADD COLUMN IF NOT EXISTS import_from timestamptz NOT NULL DEFAULT '2026-09-01T00:00:00Z',
  ADD COLUMN IF NOT EXISTS actions_found integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actions_ignored integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actions_needs_review integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS window_start timestamptz,
  ADD COLUMN IF NOT EXISTS window_end timestamptz;