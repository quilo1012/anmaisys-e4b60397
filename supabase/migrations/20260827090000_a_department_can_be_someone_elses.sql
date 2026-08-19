-- A department can be somebody else's, the same way a label can.
--
-- Until now attribution ran on labels alone. `quality_actions.department` existed, was
-- required on the log form, printed in its own column and drove a bar chart — and never
-- touched a single point. So the factory's own reading of the field ("this one is
-- Maintenance's") had no effect on the score the field looks like it should govern, and
-- clearing a machine failure off a leader meant remembering to also put the Maintenance
-- LABEL on it. Two ways to say one thing, one of which did nothing.
--
-- This makes the department an attribution axis beside the labels:
--
--   * `quality_options.counts_against_leader` — the switch, on the department rows.
--   * `scoring_version_excluded_department`   — the switch, frozen per scoring version.
--   * `action_points_at(..., _department, ...)` — the rule, applied.
--
-- The rule is a VETO, which is deliberately not what the label rule does. Read the
-- reasoning in `countsAgainstLeaderDepartment` in src/lib/qualityConstants.ts before
-- changing either: a label lives in a set, so a veto there was a lever anybody could
-- pull by adding "Maintenance" to a paperwork error, invisibly. A department is one
-- value, chosen on the way in, printed on the list, the detail panel and the export.
-- It cannot hide, so it can veto.
--
-- WHAT THIS DOES NOT DO: it does not re-price history. `points_at_creation` stays
-- exactly as frozen — 20260822090000 exists to make that true and this migration is not
-- the exception. The new rule opens a new scoring version and applies from it onward.
-- Nobody's July total moves because of a decision taken in August.

BEGIN;

-- =====================================================================
-- 1. The switch
-- =====================================================================

ALTER TABLE public.quality_options
  ADD COLUMN IF NOT EXISTS counts_against_leader boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.quality_options.counts_against_leader IS
  'Se uma accao registada neste departamento cobra pontos ao lider. Lido nas linhas kind = department. O default true e a direccao estrita: nada deixa de contar sem alguem o dizer.';

-- Production is what the lines actually book against and it charges, which is the
-- default — named here anyway so the row exists on a database seeded before it.
-- Maintenance is the whole point of the change and does not charge.
INSERT INTO public.quality_options (kind, value, active, sort, counts_against_leader)
VALUES
  ('department', 'Production',  true, 40, true),
  ('department', 'Maintenance', true, 50, false)
ON CONFLICT DO NOTHING;

-- ON CONFLICT DO NOTHING covers a fresh insert, not a Maintenance row somebody already
-- added by hand through Lists & scoring — which is exactly how this database got its
-- Production row. Without this the switch would silently stay at the default and the
-- migration would report success having changed nothing.
UPDATE public.quality_options
   SET counts_against_leader = false
 WHERE kind = 'department'
   AND lower(btrim(value)) = 'maintenance';

-- =====================================================================
-- 2. The switch, frozen per version
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.scoring_version_excluded_department (
  version_id bigint NOT NULL REFERENCES public.scoring_version(id) ON DELETE CASCADE,
  department text   NOT NULL,
  PRIMARY KEY (version_id, department)
);

COMMENT ON TABLE public.scoring_version_excluded_department IS
  'Os departamentos que NAO sao do lider nesta versao. A ausencia significa que conta. Congelado junto com os precos e com as labels excluidas, pela mesma razao: mudar quem responde por uma accao re-pontuava a historia tal como mudar um preco.';

ALTER TABLE public.scoring_version_excluded_department ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone signed in can read versioned department exclusions"
  ON public.scoring_version_excluded_department;
CREATE POLICY "Anyone signed in can read versioned department exclusions"
  ON public.scoring_version_excluded_department FOR SELECT TO authenticated USING (true);

-- =====================================================================
-- 3. The snapshot learns about departments
-- =====================================================================

CREATE OR REPLACE FUNCTION public.scoring_version_snapshot(_version_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM public.scoring_version_severity            WHERE version_id = _version_id;
  DELETE FROM public.scoring_version_label               WHERE version_id = _version_id;
  DELETE FROM public.scoring_version_excluded_label      WHERE version_id = _version_id;
  DELETE FROM public.scoring_version_excluded_department WHERE version_id = _version_id;

  INSERT INTO public.scoring_version_severity (version_id, severity, points)
  SELECT _version_id, severity, points FROM public.quality_severity_points;

  INSERT INTO public.scoring_version_label (version_id, label, points)
  SELECT _version_id, lower(trim(value)), max(points)
    FROM public.quality_options WHERE kind = 'label' AND trim(coalesce(value, '')) <> ''
   GROUP BY lower(trim(value));

  -- Guarded: quality_label_attribution arrives in its own migration and the app already
  -- treats its absence as a state to report rather than an error (see attributionMissing
  -- in QualityActionsPage). An absent table means nothing is excluded, which is the same
  -- answer an empty table gives.
  IF to_regclass('public.quality_label_attribution') IS NOT NULL THEN
    EXECUTE '
      INSERT INTO public.scoring_version_excluded_label (version_id, label)
      SELECT $1, lower(trim(label)) FROM public.quality_label_attribution
       WHERE counts_against_leader = false AND btrim(coalesce(label, '''')) <> ''''
       GROUP BY lower(trim(label))'
    USING _version_id;
  END IF;

  -- Unguarded, unlike the label exclusions above: the column is created by this same
  -- migration a few statements up, so it is there by the time this body ever runs.
  -- ACTIVE rows only — a hidden department cannot be picked on the form, so whether it
  -- would have charged is not a question this version needs an answer to.
  INSERT INTO public.scoring_version_excluded_department (version_id, department)
  SELECT _version_id, lower(btrim(value))
    FROM public.quality_options
   WHERE kind = 'department'
     AND active = true
     AND counts_against_leader = false
     AND btrim(coalesce(value, '')) <> ''
   GROUP BY lower(btrim(value));
END $$;

-- =====================================================================
-- 4. The rule
-- =====================================================================

/**
 * The SQL twin of livePoints() in src/lib/qualityConstants.ts, against a dated version.
 *
 * New signature: `_department` joins the action's own fields, `_version_id` stays last.
 * The 5-argument version is dropped at the end of this file rather than left beside it —
 * two live definitions of one rule is the drift this whole module was rebuilt to stop,
 * and a caller that missed the change would silently keep scoring without the veto.
 *
 * Guard ORDER is part of the rule and is asserted by scoringVersionParity.test.ts:
 * safety, then rejected, then department, then labels. A rejected safety row must
 * return 0 for the SAFETY reason, because that is the sentence printed beside it.
 * The department sits above the labels because it is the broader claim — it says the
 * action belongs to somebody else entirely, and no label argues that back.
 */
CREATE OR REPLACE FUNCTION public.action_points_at(
  _domain text,
  _severity text,
  _labels text[],
  _validation_status text,
  _department text,
  _version_id bigint)
RETURNS integer
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  _norm     text[];
  _excluded text[];
  _charge   integer;
  _grade    integer;
  _cap      numeric;
  _from     date;
BEGIN
  -- Safety is counted, never charged. Reporting a near miss has to stay free, or the
  -- reporting stops and the number that looks best is the one that means least.
  IF _domain = 'safety' THEN RETURN 0; END IF;
  IF _validation_status = 'rejected' THEN RETURN 0; END IF;

  -- countsAgainstLeaderDepartment: one department per action, so this is a veto. A
  -- blank department still counts — leaving the field empty must not quietly remove a
  -- deviation from somebody's score, the same rule the blank label list follows below.
  IF btrim(coalesce(_department, '')) <> ''
     AND EXISTS (SELECT 1 FROM public.scoring_version_excluded_department d
                  WHERE d.version_id = _version_id
                    AND d.department = lower(btrim(_department)))
  THEN
    RETURN 0;
  END IF;

  SELECT coalesce(array_agg(l), ARRAY[]::text[]) INTO _norm
    FROM (SELECT DISTINCT lower(trim(x)) AS l
            FROM unnest(coalesce(_labels, ARRAY[]::text[])) AS x
           WHERE trim(coalesce(x, '')) <> '') s;

  SELECT coalesce(array_agg(label), ARRAY[]::text[]) INTO _excluded
    FROM public.scoring_version_excluded_label WHERE version_id = _version_id;

  -- countsAgainstLeader: one attributable label is enough, and NO labels also counts.
  -- The second half is not an oversight — leaving the labels blank must not quietly
  -- remove a deviation from somebody's score.
  IF cardinality(_norm) > 0
     AND NOT EXISTS (SELECT 1 FROM unnest(_norm) AS l WHERE NOT (l = ANY(_excluded)))
  THEN
    RETURN 0;
  END IF;

  SELECT coalesce(sum(v.points), 0) INTO _charge
    FROM unnest(_norm) AS l
    JOIN public.scoring_version_label v
      ON v.version_id = _version_id AND v.label = l
   WHERE NOT (l = ANY(_excluded));

  -- The ceiling in force on the date this action's own version opened, not today's.
  -- Resolving it against current_date would let raising the cap in November change what
  -- a July action is worth — through the one number this whole module was rebuilt to
  -- stop moving.
  SELECT valid_from INTO _from FROM public.scoring_version WHERE id = _version_id;
  IF _from IS NOT NULL THEN
    SELECT max(value) INTO _cap
      FROM public.leader_scorecard_threshold
     WHERE name = 'CAP_LabelPoints'
       AND valid_from <= _from
       AND (valid_to IS NULL OR valid_to >= _from);
  END IF;
  -- NULL is uncapped, and LEAST would return the charge unchanged anyway — written out
  -- so the absent-parameter case is a stated reading rather than a lucky one.
  IF _cap IS NOT NULL THEN
    _charge := LEAST(_charge, _cap::integer);
  END IF;

  SELECT coalesce(points, 0) INTO _grade
    FROM public.scoring_version_severity
   WHERE version_id = _version_id AND severity = _severity;

  RETURN GREATEST(_charge, coalesce(_grade, 0));
END $$;

COMMENT ON FUNCTION public.action_points_at(text, text, text[], text, text, bigint) IS
  'O gemeo SQL de actionPoints() em src/lib/qualityConstants.ts, contra uma versao datada. Desde 20260827090000 o departamento tambem atribui, como veto. Mudar um, mudar o outro.';

-- =====================================================================
-- 5. The freeze trigger calls the new rule
-- =====================================================================

/**
 * Unchanged in intent, rewritten only to pass the department through.
 *
 * On INSERT: the version in force on the action's own recorded_at, not today's.
 * On re-grade: the action's OWN scoring_version_id. The fact gets corrected, the ruler
 * does not — using current_date here would re-open every door 20260822090000 closed.
 *
 * `department` is read through to_jsonb for the same reason `domain` is: the column is
 * optional on older databases, and a plpgsql field reference to a column that does not
 * exist fails at run time rather than degrading.
 */
CREATE OR REPLACE FUNCTION public.quality_action_freeze_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _v bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _v := public.scoring_version_at(coalesce(NEW.recorded_at, now())::date);
    NEW.scoring_version_id := _v;
    NEW.points_at_creation := public.action_points_at(
      to_jsonb(NEW)->>'domain', NEW.severity, NEW.labels, NEW.validation_status,
      to_jsonb(NEW)->>'department', _v);
    RETURN NEW;
  END IF;

  _v := coalesce(NEW.scoring_version_id,
                 public.scoring_version_at(coalesce(NEW.recorded_at, now())::date));
  NEW.scoring_version_id     := _v;
  NEW.points_at_creation     := public.action_points_at(
    to_jsonb(NEW)->>'domain', NEW.severity, NEW.labels, NEW.validation_status,
    to_jsonb(NEW)->>'department', _v);
  NEW.points_recalculated_at := now();
  RETURN NEW;
END $$;

-- Dropped only now that nothing calls it. Two live definitions of one rule is the
-- drift this module was rebuilt to stop.
DROP FUNCTION IF EXISTS public.action_points_at(text, text, text[], text, bigint);

-- =====================================================================
-- 6. Changing the switch opens a version
-- =====================================================================

-- Mirrors the label triggers from 20260822090000, including their rule: only a change
-- that can MOVE a score opens a version. Adding a department that charges moves
-- nothing — it is the default — so only an exclusion, or a change to one, counts.
DROP TRIGGER IF EXISTS trg_scoring_version_department_upd ON public.quality_options;
CREATE TRIGGER trg_scoring_version_department_upd
  AFTER UPDATE ON public.quality_options
  FOR EACH ROW WHEN (NEW.kind = 'department'
                     AND (OLD.counts_against_leader IS DISTINCT FROM NEW.counts_against_leader
                          OR (NEW.counts_against_leader = false AND OLD.active IS DISTINCT FROM NEW.active)))
  EXECUTE FUNCTION public.scoring_version_on_ruler_change();

DROP TRIGGER IF EXISTS trg_scoring_version_department_ins ON public.quality_options;
CREATE TRIGGER trg_scoring_version_department_ins
  AFTER INSERT ON public.quality_options
  FOR EACH ROW WHEN (NEW.kind = 'department' AND NEW.counts_against_leader = false)
  EXECUTE FUNCTION public.scoring_version_on_ruler_change();

DROP TRIGGER IF EXISTS trg_scoring_version_department_del ON public.quality_options;
CREATE TRIGGER trg_scoring_version_department_del
  AFTER DELETE ON public.quality_options
  FOR EACH ROW WHEN (OLD.kind = 'department' AND OLD.counts_against_leader = false)
  EXECUTE FUNCTION public.scoring_version_on_ruler_change();

-- =====================================================================
-- 7. Open the version that carries the new rule
-- =====================================================================

-- The seed above ran as plain DML before the triggers existed, so nothing has opened a
-- version for it yet. Done explicitly, once, at the end: from today Maintenance stops
-- charging, and every action already frozen keeps the figure it was frozen with.
SELECT public.scoring_version_open('Departamento passa a atribuir: Maintenance deixa de cobrar ao lider.');

COMMIT;
