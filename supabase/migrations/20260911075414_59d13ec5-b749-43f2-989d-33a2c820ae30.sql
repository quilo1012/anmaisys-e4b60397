-- =====================================================================
-- A machine fault is not the shift leader's, whatever label it carries
-- =====================================================================
--
-- The case: "Batch Code Printing Issue (L5)", 13/08, Line 5, leader Everton, labels
-- `Batch code` + `Maintenance`. The root cause is a printer failure. Attribution today
-- is per LABEL and one attributable label is enough (see countsAgainstLeader in
-- src/lib/qualityConstants.ts, and the AC-6183 note that documents that choice), so
-- `Maintenance` is excluded and worth 0 while `Batch code` still charges 5. The machine
-- fault reaches the leader's score through a side door.
--
-- The fix is NOT to flip the label rule back to a veto — that lever was removed on
-- purpose, because anyone who worked out that adding "Maintenance" to a genuine
-- paperwork error cleared it had a lever nobody audits. A root cause is a different
-- instrument: exactly ONE per action, chosen deliberately, printed in its own column,
-- written to the action's history with a name against it, and writable only by Quality.
-- That is the same reasoning `countsAgainstLeaderDepartment` (20260827093000) already
-- runs on, applied to the field that actually answers "whose failure was this".
--
-- NULLABLE ON PURPOSE. Every row that exists today keeps exactly the score it has
-- today; no history moves, and nothing is back-filled by guesswork.
--
-- What this migration does NOT touch: the gate. A food safety gate still caps the
-- period at CAP_Gate whatever the root cause turns out to be, because a gate records
-- that the event happened on this line in this period, not who was at fault. The gate
-- is computed in `scorecard_*` and in computeLeaderScore over the LABELS, never over
-- `action_points_at`, so a 0 returned here cannot silence one.

-- =====================================================================
-- 1. The column
-- =====================================================================

ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS root_cause_area text;

COMMENT ON COLUMN public.quality_actions.root_cause_area IS
  'A area responsavel pela causa raiz, escolhida em quality_options (kind = root_cause). '
  'Se a opcao tiver counts_against_leader = false, a accao vale 0 pontos, antes de qualquer '
  'aritmetica de labels — ver action_points_at. NULL significa "ainda nao se sabe" e pontua '
  'exactamente como antes desta migracao.';

-- =====================================================================
-- 2. The list lives in the table, never in code
-- =====================================================================
--
-- Same principle as the labels and the departments: which area answers for what is the
-- factory's judgement and it will change. A list in TypeScript would need a deploy.

ALTER TABLE public.quality_options DROP CONSTRAINT IF EXISTS quality_options_kind_check;
ALTER TABLE public.quality_options ADD CONSTRAINT quality_options_kind_check
  CHECK (kind = ANY (ARRAY['label'::text, 'department'::text, 'safety_label'::text,
                           'maintenance_label'::text, 'root_cause'::text]));

-- A root cause is an attribution, not a price. It answers WHOSE, and the labels answer
-- HOW MUCH; letting one carry points would put two prices on one action.
ALTER TABLE public.quality_options DROP CONSTRAINT IF EXISTS quality_options_only_labels_are_priced;
ALTER TABLE public.quality_options ADD CONSTRAINT quality_options_only_labels_are_priced
  CHECK (kind IN ('label', 'safety_label', 'maintenance_label') OR points = 0);

INSERT INTO public.quality_options (kind, value, active, sort, points, is_gate, counts_against_leader)
VALUES
  ('root_cause', 'Production',  true, 10, 0, false, true),
  ('root_cause', 'Quality',     true, 20, 0, false, true),
  ('root_cause', 'Maintenance', true, 30, 0, false, false),
  ('root_cause', 'Warehouse',   true, 40, 0, false, false),
  ('root_cause', 'Engineering', true, 50, 0, false, false),
  ('root_cause', 'Supplier',    true, 60, 0, false, false),
  ('root_cause', 'External',    true, 70, 0, false, false)
ON CONFLICT (kind, value) DO NOTHING;

-- =====================================================================
-- 3. The rule, ahead of every other rule
-- =====================================================================
--
-- Read LIVE from quality_options rather than from a scoring_version_* snapshot, and the
-- difference is deliberate. The versioned tables freeze PRICES — what a Critical or a
-- Foreign Body was worth on a given date — because re-pricing in November must not
-- rewrite July. This is not a price. It is a statement of fact about one action: the
-- printer failed. A fact corrected today was always true, and the freeze machinery's own
-- rule for a corrected fact is that it recomputes against the action's OWN version,
-- which is exactly what happens below in quality_action_freeze_points.

CREATE OR REPLACE FUNCTION public.action_points_at(
  _domain text,
  _severity text,
  _labels text[],
  _validation_status text,
  _department text,
  _root_cause text,
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

  -- The root cause outranks the labels, the department and the grade, because it is the
  -- broader claim: this deviation is somebody else's failure and no label can argue it
  -- back. A blank root cause counts, for the same reason a blank department and a blank
  -- label list count — leaving a field empty must never quietly remove a deviation from
  -- somebody's score.
  IF btrim(coalesce(_root_cause, '')) <> ''
     AND EXISTS (SELECT 1 FROM public.quality_options o
                  WHERE o.kind = 'root_cause'
                    AND lower(btrim(o.value)) = lower(btrim(_root_cause))
                    AND o.counts_against_leader = false)
  THEN
    RETURN 0;
  END IF;

  _kind := CASE WHEN _domain = 'safety' THEN 'safety_label' ELSE 'label' END;

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

  IF _domain = 'safety' THEN RETURN _charge; END IF;

  SELECT coalesce(points, 0) INTO _grade
    FROM public.scoring_version_severity
   WHERE version_id = _version_id AND severity = _severity;

  RETURN GREATEST(_charge, coalesce(_grade, 0));
END $$;

COMMENT ON FUNCTION public.action_points_at(text, text, text[], text, text, text, bigint) IS
  'O gemeo SQL de livePoints() em src/lib/qualityConstants.ts, contra uma versao datada. '
  'Desde esta migracao uma causa raiz que nao seja do lider anula a accao (0) antes de qualquer '
  'aritmetica de labels. Mudar um, mudar o outro — ver src/__tests__/rootCauseParity.test.ts.';

-- =====================================================================
-- 4. Setting a root cause recomputes THAT action, on ITS OWN ruler
-- =====================================================================
--
-- The UPDATE branch already recomputes against NEW.scoring_version_id and stamps
-- points_recalculated_at, which is precisely the behaviour asked for; all it needed was
-- the new argument. current_date is deliberately NOT used here — correcting a fact must
-- not re-score the action on today's scale.

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
      to_jsonb(NEW)->>'department', to_jsonb(NEW)->>'root_cause_area', _v);
    RETURN NEW;
  END IF;

  _v := coalesce(NEW.scoring_version_id,
                 public.scoring_version_at(coalesce(NEW.recorded_at, now())::date));
  NEW.scoring_version_id     := _v;
  NEW.points_at_creation     := public.action_points_at(
    to_jsonb(NEW)->>'domain', NEW.severity, NEW.labels, NEW.validation_status,
    to_jsonb(NEW)->>'department', to_jsonb(NEW)->>'root_cause_area', _v);
  NEW.points_recalculated_at := now();
  RETURN NEW;
END $$;

-- Two live definitions of one rule is the drift this module was rebuilt to stop.
DROP FUNCTION IF EXISTS public.action_points_at(text, text, text[], text, text, bigint);

-- =====================================================================
-- 5. A change of root cause is written down, like any other field change
-- =====================================================================

CREATE OR REPLACE FUNCTION public.log_quality_action_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, COALESCE(NEW.recorded_by, auth.uid()), 'created', NULL, NEW.status);
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'status', OLD.status, NEW.status);
  END IF;
  IF NEW.severity IS DISTINCT FROM OLD.severity THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'severity', OLD.severity, NEW.severity);
  END IF;
  IF NEW.validation_status IS DISTINCT FROM OLD.validation_status THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'validation_status', OLD.validation_status, NEW.validation_status);
  END IF;
  -- Who moved the charge off a leader, and when. Without this the one field that can
  -- zero an action would be the only one that changed without a name against it.
  IF NEW.root_cause_area IS DISTINCT FROM OLD.root_cause_area THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'root_cause_area', OLD.root_cause_area, NEW.root_cause_area);
  END IF;
  IF (NEW.closed_at IS NULL) IS DISTINCT FROM (OLD.closed_at IS NULL) THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'closure',
            CASE WHEN OLD.closed_at IS NULL THEN 'open' ELSE 'closed' END,
            CASE WHEN NEW.closed_at IS NULL THEN 'reopened' ELSE 'closed' END);
  END IF;
  IF NEW.labels IS DISTINCT FROM OLD.labels THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'labels',
            array_to_string(COALESCE(OLD.labels,'{}'), ', '),
            array_to_string(COALESCE(NEW.labels,'{}'), ', '));
  END IF;
  RETURN NEW;
END
$function$;

-- =====================================================================
-- 6. Only Quality may write it
-- =====================================================================
--
-- A trigger rather than a policy, because RLS is row-level: the existing quality_actions
-- UPDATE policy has to keep letting a manager edit a description, and there is no way to
-- say "every column but this one" in a USING clause. Reading is untouched — anybody who
-- can see the action sees the field, which is the whole point of putting the reason for
-- a zero on the screen.
--
-- has_action(), never has_role(): it reads role_permission_overrides first, so the
-- Permissions screen can move this without a migration. The baselines mirror
-- MATRIX["quality.validate"] and MATRIX["quality.manage"] in src/lib/permissions.ts.
--
-- auth.uid() IS NULL is allowed through: that is the service role and the SafetyCulture
-- importer, neither of which sets this field, and refusing them would break the import
-- for a column they never touch.

CREATE OR REPLACE FUNCTION public.guard_quality_root_cause()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.root_cause_area IS NULL THEN RETURN NEW; END IF;
  ELSIF NEW.root_cause_area IS NOT DISTINCT FROM OLD.root_cause_area THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF public.has_action(auth.uid(), 'quality.validate',
        ARRAY['admin','quality_supervisor']::app_role[])
     OR public.has_action(auth.uid(), 'quality.manage',
        ARRAY['admin','manager','quality_supervisor','production_office_admin']::app_role[])
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only Quality may set the root cause of an action.'
    USING ERRCODE = '42501';
END $$;

REVOKE ALL ON FUNCTION public.guard_quality_root_cause() FROM PUBLIC;

-- Named to sort BEFORE trg_enforce_quality_validation and the two freeze triggers:
-- Postgres fires same-timing triggers in name order, and a write that is about to be
-- refused must not first be frozen at a new figure.
DROP TRIGGER IF EXISTS trg_a_quality_root_cause_guard ON public.quality_actions;
CREATE TRIGGER trg_a_quality_root_cause_guard
  BEFORE INSERT OR UPDATE ON public.quality_actions
  FOR EACH ROW EXECUTE FUNCTION public.guard_quality_root_cause();
