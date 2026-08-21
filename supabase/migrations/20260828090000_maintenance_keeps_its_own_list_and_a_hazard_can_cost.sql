-- Maintenance gets a list of its own, and a hazard may be priced.
--
-- Two changes that arrive together because they are the same change to one screen —
-- Lists & scoring now shows four lists, and three of them carry a points box.
--
-- What each list's price DOES is the part worth reading slowly:
--
--   label             priced, charges, may gate    (unchanged)
--   safety_label      priced, charges, never gates (NEW — see below)
--   maintenance_label priced, NEVER charges        (NEW)
--   department        never priced                 (unchanged)
--
-- Health & Safety pricing reverses a rule this schema has enforced since 20260817090000
-- and the reasoning against it still stands and is still enforced: a score that
-- punishes the report teaches the team to stop reporting. So the SEVERITY grade still
-- cannot charge a safety occurrence at all — an unpriced hazard is 0 however badly it
-- is graded, and a near miss is free by default. What is now possible is pricing one
-- named hazard deliberately, on a screen that says so, one row at a time.
--
-- The two price lists are kept APART rather than merged, which is the subtle half.
-- Occurrences logged before the lists split carry QUALITY labels — Foreign Body, GMP —
-- because that was the only list there was. One flat price table would have made
-- pricing Foreign Path for the quality log start charging those old occurrences too,
-- silently, for a decision nobody made about safety. So `scoring_version_label` gains
-- a `kind` and the domain picks which rows apply.
--
-- The TypeScript twin is `livePoints` / `standsAgainstLeader` / `chargingLabelPoints`
-- in src/lib/qualityConstants.ts. Change one, change the other — the parity test
-- src/__tests__/scoringVersionParity.test.ts exists to catch it when they drift.

-- =====================================================================
-- 1. A fourth kind, and three lists that may carry a price
-- =====================================================================

ALTER TABLE public.quality_options DROP CONSTRAINT IF EXISTS quality_options_kind_check;
ALTER TABLE public.quality_options
  ADD CONSTRAINT quality_options_kind_check
  CHECK (kind IN ('label', 'department', 'safety_label', 'maintenance_label'));

-- Departments are not labels and never price anything. That half of
-- 20260815120000's rule is unchanged; what widens is which LABEL kinds may.
ALTER TABLE public.quality_options DROP CONSTRAINT IF EXISTS quality_options_only_labels_are_priced;
ALTER TABLE public.quality_options
  ADD CONSTRAINT quality_options_only_labels_are_priced
  CHECK (kind <> 'department' OR points = 0);

-- Gates do NOT widen with the points box. A gate caps a whole period at CAP_Gate and
-- forces it Red; that is a food-safety ceiling and only the quality list may set one.
-- 20260824090000's constraint already says so and is deliberately left alone.

COMMENT ON COLUMN public.quality_options.points IS
  'What this label charges an action, 0 = unpriced. Charged for kind label (quality) and safety_label (hazards); shown but never charged for maintenance_label; always 0 for department.';

INSERT INTO public.quality_options (kind, value, sort) VALUES
  ('maintenance_label', 'Breakdown', 1),
  ('maintenance_label', 'Bearing failure', 2),
  ('maintenance_label', 'Belt / conveyor', 3),
  ('maintenance_label', 'Sensor / photocell', 4),
  ('maintenance_label', 'Air leak', 5),
  ('maintenance_label', 'Electrical fault', 6),
  ('maintenance_label', 'Lubrication', 7),
  ('maintenance_label', 'Spare part missing', 8),
  ('maintenance_label', 'Calibration', 9)
ON CONFLICT (kind, value) DO NOTHING;

-- =====================================================================
-- 2. The frozen price list learns which list a price came from
-- =====================================================================

-- Default 'label' so every row already frozen keeps meaning exactly what it meant:
-- a quality label's price. Nothing is re-scored by this migration.
ALTER TABLE public.scoring_version_label
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'label';

DO $$ BEGIN
  ALTER TABLE public.scoring_version_label
    ADD CONSTRAINT scoring_version_label_kind_check
    CHECK (kind IN ('label', 'safety_label'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The primary key has to widen with it: the same word may appear on both lists in
-- principle, and a key that could not tell them apart would drop one at snapshot time.
DO $$ BEGIN
  ALTER TABLE public.scoring_version_label DROP CONSTRAINT scoring_version_label_pkey;
  ALTER TABLE public.scoring_version_label
    ADD CONSTRAINT scoring_version_label_pkey PRIMARY KEY (version_id, kind, label);
EXCEPTION WHEN undefined_object THEN NULL; END $$;

COMMENT ON COLUMN public.scoring_version_label.kind IS
  'De que lista veio o preco: label (accoes de qualidade) ou safety_label (perigos). O dominio da accao escolhe qual se aplica — um preco de qualidade nao cobra uma ocorrencia de seguranca, nem o contrario.';

-- =====================================================================
-- 3. The snapshot freezes both priced lists
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

  -- Both priced lists, kept apart by kind. `maintenance_label` is deliberately absent:
  -- it is priced for whoever reads the log and never charges a leader, so freezing its
  -- numbers would put a figure in the scoring tables that no rule may read.
  INSERT INTO public.scoring_version_label (version_id, kind, label, points)
  SELECT _version_id, kind, lower(trim(value)), max(points)
    FROM public.quality_options
   WHERE kind IN ('label', 'safety_label') AND trim(coalesce(value, '')) <> ''
   GROUP BY kind, lower(trim(value));

  IF to_regclass('public.quality_label_attribution') IS NOT NULL THEN
    EXECUTE '
      INSERT INTO public.scoring_version_excluded_label (version_id, label)
      SELECT $1, lower(trim(label)) FROM public.quality_label_attribution
       WHERE counts_against_leader = false AND btrim(coalesce(label, '''')) <> ''''
       GROUP BY lower(trim(label))'
      USING _version_id;
  END IF;

  -- Unchanged from 20260827093000, active filter included: a hidden department cannot
  -- be picked on the form, so whether it would have charged is not a question this
  -- version needs an answer to.
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
-- 4. The rule itself: a hazard charges what it is priced at, and nothing else
-- =====================================================================

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
  _kind     text;
  _charge   integer;
  _grade    integer;
  _cap      numeric;
  _from     date;
BEGIN
  IF _validation_status = 'rejected' THEN RETURN 0; END IF;

  -- Which price list applies. The domain decides, and it decides for the whole action:
  -- a safety occurrence is priced by the hazard list and by nothing else.
  _kind := CASE WHEN _domain = 'safety' THEN 'safety_label' ELSE 'label' END;

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
      ON v.version_id = _version_id AND v.kind = _kind AND v.label = l
   WHERE NOT (l = ANY(_excluded));

  -- The ceiling in force on the date this action's own version opened, not today's.
  SELECT valid_from INTO _from FROM public.scoring_version WHERE id = _version_id;
  IF _from IS NOT NULL THEN
    SELECT max(value) INTO _cap
      FROM public.leader_scorecard_threshold
     WHERE name = 'CAP_LabelPoints'
       AND valid_from <= _from
       AND (valid_to IS NULL OR valid_to >= _from);
  END IF;
  IF _cap IS NOT NULL THEN
    _charge := LEAST(_charge, _cap::integer);
  END IF;

  -- Safety stops here. The priced hazard is the whole charge and the grade never adds
  -- to it: otherwise every occurrence would start charging the moment somebody graded
  -- it, and reporting a near miss would stop being free. Mirrors the same early return
  -- in `livePoints`.
  IF _domain = 'safety' THEN RETURN _charge; END IF;

  SELECT coalesce(points, 0) INTO _grade
    FROM public.scoring_version_severity
   WHERE version_id = _version_id AND severity = _severity;

  RETURN GREATEST(_charge, coalesce(_grade, 0));
END $$;

COMMENT ON FUNCTION public.action_points_at(text, text, text[], text, text, bigint) IS
  'O gemeo SQL de actionPoints() em src/lib/qualityConstants.ts, contra uma versao datada. Desde 20260828090000 uma ocorrencia de seguranca e cobrada pelo preco do seu perigo — e so por ele, nunca pela gravidade. Mudar um, mudar o outro.';

-- =====================================================================
-- 5. Re-freeze the OPEN version so it holds the hazard prices too
-- =====================================================================
--
-- Only the open one. Closed versions are the record of what past actions were charged
-- and re-snapshotting them would re-score history, which is the one thing 20260822090000
-- exists to prevent. The open version has no hazard rows until this runs, which would
-- read as "every hazard is unpriced" — true today, since nothing has been priced yet,
-- and it stops being true the moment somebody types a number.

DO $$
DECLARE _open bigint;
BEGIN
  SELECT id INTO _open FROM public.scoring_version WHERE valid_to IS NULL ORDER BY valid_from DESC LIMIT 1;
  IF _open IS NOT NULL THEN
    PERFORM public.scoring_version_snapshot(_open);
  END IF;
END $$;
