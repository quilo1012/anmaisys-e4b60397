-- iTouching says the line went on break. The order's clock stops with it.
--
-- The manual path already exists: someone records a team activity against the order
-- and every downtime view subtracts the overlap. This feeds the SAME table from the
-- other end, so a break nobody remembered to log is still taken off — and there is
-- still exactly one subtraction, not a second opinion about the same minutes.
--
-- Line 3 raises an auto order at 21:10 because a machine failed. At 21:39 iTouching
-- reports Line 3 on Breaks until 22:01. Those 22 minutes stop counting against the
-- order, without anyone touching the screen.

-- Where the row came from, so a machine's guess is never mistaken for a person's
-- record — and so the trigger can update its own rows without touching anybody else's.
ALTER TABLE public.wo_downtime_exclusions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS downtime_id uuid;

ALTER TABLE public.wo_downtime_exclusions DROP CONSTRAINT IF EXISTS wo_downtime_exclusions_source_check;
ALTER TABLE public.wo_downtime_exclusions
  ADD CONSTRAINT wo_downtime_exclusions_source_check CHECK (source IN ('manual', 'intouch'));

-- One exclusion per order per iTouching stop. Re-polling the same stop updates the
-- row rather than stacking a second copy of the same twenty minutes.
CREATE UNIQUE INDEX IF NOT EXISTS wo_downtime_exclusions_intouch_uniq
  ON public.wo_downtime_exclusions (work_order_id, downtime_id)
  WHERE downtime_id IS NOT NULL;

/**
 * Which stop codes pause an order's clock.
 *
 * A table, not a list in a function: the factory reclassifies codes in iTouching's
 * Admin Centre, and adding "Deep Clean" here should be a row rather than a migration.
 *
 * Seeded with exactly the three activities the exclusions table already understands
 * — break, filling blender, brushing & cleaning. The other planned codes (Deep Clean,
 * Drill Cleaning, Line Preparation, Metal Detector Checks, Changeover, No Planned
 * Shift) are deliberately NOT here: "No Planned Shift" alone carries 421-minute
 * stretches, and writing those off an order is a decision for the factory to take
 * openly rather than something a migration does quietly.
 */
CREATE TABLE IF NOT EXISTS public.intouch_exclusion_map (
  stop_code_name text PRIMARY KEY,
  activity text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

-- 'planned_stop' joins the three named activities: a code an admin switches on here
-- that nobody has classified is recorded as what it is, rather than being squeezed
-- into "break" so the order reads a story that did not happen.
ALTER TABLE public.wo_downtime_exclusions DROP CONSTRAINT IF EXISTS wo_downtime_exclusions_activity_check;
ALTER TABLE public.wo_downtime_exclusions ADD CONSTRAINT wo_downtime_exclusions_activity_check
  CHECK (activity = ANY (ARRAY['break','filling_blender','brushing_cleaning','planned_stop']));
ALTER TABLE public.intouch_exclusion_map DROP CONSTRAINT IF EXISTS intouch_exclusion_map_activity_check;
ALTER TABLE public.intouch_exclusion_map ADD CONSTRAINT intouch_exclusion_map_activity_check
  CHECK (activity = ANY (ARRAY['break','filling_blender','brushing_cleaning','planned_stop']));

INSERT INTO public.intouch_exclusion_map (stop_code_name, activity) VALUES
  ('Breaks', 'break'),
  ('Filling Blender/ Blending', 'filling_blender'),
  ('Brushing and Cleaning', 'brushing_cleaning')
ON CONFLICT (stop_code_name) DO NOTHING;

ALTER TABLE public.intouch_exclusion_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intouch_exclusion_map read" ON public.intouch_exclusion_map;
CREATE POLICY "intouch_exclusion_map read" ON public.intouch_exclusion_map
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "intouch_exclusion_map admin" ON public.intouch_exclusion_map;
CREATE POLICY "intouch_exclusion_map admin" ON public.intouch_exclusion_map
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

/**
 * When the poll records a planned stop, pause the clock of any order stopping that
 * line at the time.
 *
 * Only orders that are actually holding the line: line_stopped, not resumed before
 * the break began, and not a warehouse or preventive order — neither of those books
 * downtime in the first place.
 *
 * The exclusion is clipped to the order's own stop window. A break that starts before
 * the machine failed did not pause a clock that had not started.
 */
CREATE OR REPLACE FUNCTION public.intouch_planned_stop_pauses_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _activity text;
  _wo record;
  _from timestamptz;
  _to timestamptz;
BEGIN
  IF NEW.line IS NULL OR NEW.started_at IS NULL THEN RETURN NEW; END IF;

  SELECT m.activity INTO _activity
  FROM public.intouch_exclusion_map m
  WHERE m.active AND lower(btrim(m.stop_code_name)) = lower(btrim(NEW.reason));

  IF _activity IS NULL THEN RETURN NEW; END IF;

  FOR _wo IN
    SELECT w.id, w.line_stopped_at, w.line_resumed_at
    FROM public.work_orders w
    WHERE lower(btrim(w.line_at_time)) = lower(btrim(NEW.line))
      AND w.line_stopped_at IS NOT NULL
      AND COALESCE(w.wo_type, 'production') NOT IN ('warehouse_service', 'preventive')
      AND w.line_stopped_at < COALESCE(NEW.ended_at, now())
      AND COALESCE(w.line_resumed_at, now()) > NEW.started_at
  LOOP
    -- Clip to the part of the break that falls inside this order's stoppage.
    _from := GREATEST(NEW.started_at, _wo.line_stopped_at);
    _to := LEAST(COALESCE(NEW.ended_at, now()), COALESCE(_wo.line_resumed_at, now()));
    IF _to <= _from THEN CONTINUE; END IF;

    INSERT INTO public.wo_downtime_exclusions
      (work_order_id, activity, started_at, ended_at, source, downtime_id, started_by_name, note)
    VALUES
      (_wo.id, _activity, _from, CASE WHEN NEW.ended_at IS NULL THEN NULL ELSE _to END,
       'intouch', NEW.id, 'iTouching',
       'Recorded automatically: iTouching reported ' || COALESCE(NEW.reason, 'a planned stop') || ' on this line.')
    -- The index is partial, so the predicate has to be repeated here for Postgres to
    -- infer it. Without the WHERE it raises "no unique or exclusion constraint
    -- matching the ON CONFLICT specification" — from inside a trigger, which means
    -- the poll's insert fails rather than the exclusion quietly not happening.
    ON CONFLICT (work_order_id, downtime_id) WHERE downtime_id IS NOT NULL
    DO UPDATE SET
      started_at = EXCLUDED.started_at,
      ended_at = EXCLUDED.ended_at,
      activity = EXCLUDED.activity;
  END LOOP;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_intouch_planned_stop_pauses_orders ON public.production_downtimes;
CREATE TRIGGER trg_intouch_planned_stop_pauses_orders
  AFTER INSERT OR UPDATE OF started_at, ended_at, reason, line ON public.production_downtimes
  FOR EACH ROW EXECUTE FUNCTION public.intouch_planned_stop_pauses_orders();

COMMENT ON FUNCTION public.intouch_planned_stop_pauses_orders() IS
  'Feeds wo_downtime_exclusions from iTouching planned stops so an order stops counting downtime while the line is on a break, filling the blender, or brushing and cleaning.';

-- Verified against real orders on Line 3 (23/06), in a transaction that was rolled
-- back: a break 12:40–12:50 took 10 minutes off both orders holding the line;
-- Brushing and Cleaning 12:10–12:30 was clipped to each order's own start, giving 16
-- minutes to the one stopped at 12:13:55 and 6 to the one stopped at 12:23:40; and a
-- Maintenance Issue in the same window was correctly left alone.
