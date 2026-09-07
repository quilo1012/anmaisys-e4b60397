-- Every imported action scored one point, and the Priority column held a UUID.
--
-- Measured across all 49 records imported from SafetyCulture on 07/09/2026:
--
--   action_no          0/49   the number the floor reads off the SafetyCulture screen
--   labels             2/49   and one of those two says "Label" — a rule's own name
--   severity           0/49
--   priority as text   0/49   all 49 hold a bare UUID
--
-- Four separate causes, not one. Two of them decide the score: `action_points_at`
-- returns GREATEST(label charge, severity grade), and BOTH inputs were empty on every
-- record, so all 49 fell to the default of 1 whatever they described — a metal finding
-- and a missing signature worth the same.
--
-- The priority is its own problem. SafetyCulture answers with `priority_id`, a UUID,
-- and sends no name for it anywhere in the response — checked against the published
-- API schema, not assumed — and there is no endpoint that lists priorities. So the
-- name cannot be derived; it has to be recorded once, here, and the UUID has to be
-- kept because it is the only thing SafetyCulture actually said.

-- ── Keep the id, and stop passing it off as a name ────────────────────────────────
ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS external_priority_id text;

COMMENT ON COLUMN public.quality_actions.external_priority_id IS
  'The priority UUID exactly as SafetyCulture sent it. `external_priority` holds the '
  'readable name, and stays NULL until the UUID is mapped in sc_priorities — a UUID '
  'on screen is not a priority, it is a gap for somebody to close.';

-- ── What the UUIDs mean ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sc_priorities (
  priority_id text PRIMARY KEY,
  name        text NOT NULL,
  -- Maps onto the severity scale that already scores: critical 5, high 4, medium 3,
  -- low 2. Deliberately NOT a second scale — two tables deciding one number drift,
  -- and the drift is silent.
  severity    text CHECK (severity IS NULL OR severity IN ('critical','high','medium','low')),
  rank        integer NOT NULL DEFAULT 100,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sc_priorities TO authenticated;
GRANT ALL ON public.sc_priorities TO service_role;
ALTER TABLE public.sc_priorities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sc priorities readable by staff" ON public.sc_priorities;
CREATE POLICY "sc priorities readable by staff"
  ON public.sc_priorities FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Quality owns the severity weights, so Quality owns what a priority grades as.
DROP POLICY IF EXISTS "sc priorities editable by quality" ON public.sc_priorities;
CREATE POLICY "sc priorities editable by quality"
  ON public.sc_priorities FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
    OR public.is_owner(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
    OR public.is_owner(auth.uid())
  );

DROP TRIGGER IF EXISTS trg_sc_priorities_updated ON public.sc_priorities;
CREATE TRIGGER trg_sc_priorities_updated BEFORE UPDATE ON public.sc_priorities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The three in use, confirmed by the factory against the SafetyCulture screen.
--
-- They were separated first by their default due window, which is exact and does not
-- overlap: 3 days, 7 days, and 8.99-9.00 days across 49 records. That is what made
-- the question answerable — but the NAMES come from a person who read them off
-- SafetyCulture, not from the due dates. Another organisation's UUIDs are different
-- ones, which is why this is a table and not a list in the code.
INSERT INTO public.sc_priorities (priority_id, name, severity, rank, note) VALUES
  ('02eb40c1-4f46-40c5-be16-d32941c96ec9', 'High',   'high',   10, 'Default due window: 3 days.'),
  ('ce87c58a-eeb2-4fde-9dc4-c6e85f1f4055', 'Medium', 'medium', 20, 'Default due window: 7 days.'),
  ('16ba4717-adc9-4d48-bf7c-044cfe0d2727', 'Low',    'low',    30, 'Default due window: 9 days.')
ON CONFLICT (priority_id) DO NOTHING;

-- ── Move the UUIDs to the column that is meant to hold them ───────────────────────
UPDATE public.quality_actions
SET external_priority_id = external_priority
WHERE source = 'safetyculture'
  AND external_priority_id IS NULL
  AND external_priority ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- ...and put the name where a person reads it.
UPDATE public.quality_actions qa
SET external_priority = p.name
FROM public.sc_priorities p
WHERE qa.source = 'safetyculture'
  AND qa.external_priority_id = p.priority_id
  AND qa.external_priority IS DISTINCT FROM p.name;

-- ── Give the scorer something to grade ────────────────────────────────────────────
-- Only where nothing has graded it already: a severity set by hand, or by a rule
-- written about that kind of finding, is a deliberate judgement and outranks a
-- priority that came off a template default.
--
-- `quality_action_freeze_points` recalculates `points_at_creation` on UPDATE, so this
-- re-scores the 49 records as a side effect of setting the column. That is the point
-- of it: nothing here writes a score directly.
UPDATE public.quality_actions qa
SET severity = p.severity
FROM public.sc_priorities p
WHERE qa.source = 'safetyculture'
  AND qa.external_priority_id = p.priority_id
  AND p.severity IS NOT NULL
  AND qa.severity IS NULL;

-- The labels and the action numbers are NOT repaired here, and cannot be: they were
-- discarded on the way in and were never stored. They arrive on the next sync, now
-- that `parseAction` reads `unique_id` and `buildRecord` keeps `action_label`.
