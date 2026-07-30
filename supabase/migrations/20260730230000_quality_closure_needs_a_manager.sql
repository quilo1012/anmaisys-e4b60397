-- Quality judges the deviation. A manager approves filing it.
--
-- BRD item 8 splits those two, and the first cut of the lifecycle had them merged:
-- validate, reject and close were all one field, all open to the same three roles. So
-- the person who decided a leader lost points could also file the matter closed, and
-- an action could be closed with no verdict at all.
--
-- Closure is now its own pair of columns rather than a fifth value of
-- validation_status. That is not cosmetic: with "closed" as a status, closing a
-- validated action overwrote the verdict, and the leader's penalty silently
-- disappeared the moment somebody tidied up the board. The verdict stays the verdict;
-- closure sits beside it.
ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by uuid;

ALTER TABLE public.quality_actions DROP CONSTRAINT IF EXISTS quality_actions_validation_status_check;
ALTER TABLE public.quality_actions
  ADD CONSTRAINT quality_actions_validation_status_check
  CHECK (validation_status IN ('open','under_investigation','validated','rejected'));

CREATE OR REPLACE FUNCTION public.enforce_quality_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_admin boolean;
  _is_quality boolean;
  _is_manager boolean;
  _verdict_changed boolean := new.validation_status IS DISTINCT FROM old.validation_status;
  _closure_changed boolean := (new.closed_at IS NULL) IS DISTINCT FROM (old.closed_at IS NULL);
BEGIN
  IF NOT _verdict_changed AND NOT _closure_changed THEN RETURN new; END IF;

  -- Backend paths (cron, service key) have no auth.uid(); RLS keeps anon out.
  IF _uid IS NULL THEN RETURN new; END IF;

  _is_admin   := has_role(_uid,'admin');
  _is_quality := _is_admin OR has_role(_uid,'quality_supervisor');
  _is_manager := _is_admin OR has_role(_uid,'manager') OR has_role(_uid,'maintenance_manager');

  IF _verdict_changed THEN
    -- A closed action is a filed record. Changing its verdict changes a leader's
    -- score after the fact, so it takes a manager reopening it first — and that
    -- reopening is in the history.
    IF old.closed_at IS NOT NULL AND new.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'This action is closed. A manager must reopen it before the verdict can change.';
    END IF;

    IF new.validation_status IN ('validated','rejected') AND NOT _is_quality THEN
      RAISE EXCEPTION 'Only Quality or an admin can validate or reject a quality action.';
    END IF;

    IF new.validation_status = 'validated' THEN
      -- ALCOA+: a validated deviation carries its evidence.
      IF COALESCE(array_length(new.attachments, 1), 0) = 0 THEN
        RAISE EXCEPTION 'Attach the evidence before validating this action.';
      END IF;
      new.validated_by := COALESCE(new.validated_by, _uid);
      new.validated_at := COALESCE(new.validated_at, now());
    ELSE
      -- Withdrawing the verdict withdraws the signature with it.
      new.validated_by := NULL;
      new.validated_at := NULL;
    END IF;
  END IF;

  IF _closure_changed THEN
    IF NOT _is_manager THEN
      RAISE EXCEPTION 'Only a manager or an admin can approve the closure of a quality action.';
    END IF;
    IF new.closed_at IS NOT NULL THEN
      IF new.validation_status NOT IN ('validated','rejected') THEN
        RAISE EXCEPTION 'Quality must validate or reject this action before it can be closed.';
      END IF;
      new.closed_by := COALESCE(new.closed_by, _uid);
      new.closed_at := COALESCE(new.closed_at, now());
    ELSE
      new.closed_by := NULL;
    END IF;
  END IF;

  RETURN new;
END
$function$;

-- Closure joins the verdict and the category in the audit trail.
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
