-- A quality action is not a penalty until Quality says it is.
--
-- The leader scorecard is meant to answer, in an audit: "why did this leader lose
-- points?" It cannot do that while the only states are todo / in_progress / complete,
-- because an action counts the moment somebody types it — no investigation, no
-- verdict, nobody's name against the decision.
--
-- So the lifecycle from the BRD:
--   open → under_investigation → validated | rejected → closed
-- and only `validated` ever costs points.
--
-- Deliberately additive: `status` (the kanban column) stays exactly as it was, so
-- nothing on the board changes. This is the separate question of whether the
-- deviation is real.
ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'open'
    CHECK (validation_status IN ('open','under_investigation','validated','rejected','closed')),
  ADD COLUMN IF NOT EXISTS validated_by uuid,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz;

CREATE INDEX IF NOT EXISTS quality_actions_validation_idx
  ON public.quality_actions (validation_status, leader_name, recorded_at);

-- Who may judge, and on what evidence.
--
-- Enforced in the database rather than the screen: the scorecard is only defensible
-- if the rule holds for every path into the table, including the REST API that any
-- role with UPDATE can reach.
CREATE OR REPLACE FUNCTION public.enforce_quality_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_quality boolean;
BEGIN
  IF new.validation_status IS NOT DISTINCT FROM old.validation_status THEN
    RETURN new;
  END IF;

  -- Backend paths (cron, service key) have no auth.uid(); RLS keeps anon out.
  IF _uid IS NULL THEN RETURN new; END IF;

  _is_quality := has_role(_uid,'admin') OR has_role(_uid,'quality_supervisor') OR has_role(_uid,'manager');

  -- Anyone may open a deviation or move it into investigation. Only Quality decides
  -- whether it is real, because that verdict costs a leader points.
  IF new.validation_status IN ('validated','rejected','closed') AND NOT _is_quality THEN
    RAISE EXCEPTION 'Only Quality, a manager or an admin can validate, reject or close a quality action.';
  END IF;

  IF new.validation_status = 'validated' THEN
    -- ALCOA+: a validated deviation carries its evidence. A penalty nobody can
    -- substantiate is the first thing an auditor asks about.
    IF COALESCE(array_length(new.attachments, 1), 0) = 0 THEN
      RAISE EXCEPTION 'Attach the evidence before validating this action.';
    END IF;
    new.validated_by := COALESCE(new.validated_by, _uid);
    new.validated_at := COALESCE(new.validated_at, now());
  ELSE
    -- Leaving validated withdraws the penalty, so the signature goes with it.
    new.validated_by := NULL;
    new.validated_at := NULL;
  END IF;

  RETURN new;
END
$function$;

DROP TRIGGER IF EXISTS trg_enforce_quality_validation ON public.quality_actions;
CREATE TRIGGER trg_enforce_quality_validation
BEFORE UPDATE ON public.quality_actions
FOR EACH ROW EXECUTE FUNCTION public.enforce_quality_validation();

-- The audit trail already recorded status and severity. It now records the two
-- changes that decide a penalty: the verdict, and the category that makes an action
-- a paperwork error in the first place.
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
  IF NEW.labels IS DISTINCT FROM OLD.labels THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'labels',
            array_to_string(COALESCE(OLD.labels,'{}'), ', '),
            array_to_string(COALESCE(NEW.labels,'{}'), ', '));
  END IF;
  RETURN NEW;
END
$function$;
