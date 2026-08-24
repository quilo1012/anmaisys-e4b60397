-- The two switches that already worked, and could not be turned off.
--
-- `enforce_quality_validation` is the audit gate: who may rule on a quality action,
-- and who may approve its closure. It has always enforced them properly — and it has
-- always enforced them against two role lists written into the function body:
--
--   _is_quality := _is_admin OR has_role(_uid,'quality_supervisor');
--   _is_manager := _is_admin OR has_role(_uid,'manager') OR has_role(_uid,'maintenance_manager');
--
-- Those agree with the matrix exactly — `quality.validate` is admin + quality_supervisor,
-- `quality.close` is admin + manager + maintenance_manager. Nothing is wrong today.
--
-- What is wrong is that the agreement is a coincidence maintained by hand. The
-- Permissions page shows both switches; an admin turning `quality.validate` off for
-- the quality_supervisor changes the menu, changes what the screen offers, and changes
-- nothing here. The verdict still goes through. A switch that lies about the audit
-- gate is worse than no switch, because the person who flicked it believes it.
--
-- So the lists are replaced by `has_action` (20260813094905), which reads
-- `role_permission_overrides` — the switches themselves — and falls back to the
-- baseline when nobody has overridden anything. The baselines passed below are the
-- two lists above, unchanged, so on a database where nothing is overridden this
-- migration changes no behaviour at all. That is the point: it makes the switches
-- true without moving anybody's access.
--
-- Nothing else in the function changes. `_uid IS NULL` still lets backend paths
-- through, a closed action still has to be reopened before its verdict moves, closure
-- still needs a verdict first, and withdrawing a verdict still withdraws the
-- signature. `_is_admin` is gone because `has_action` already resolves admin to true
-- on its own — see its CASE — so keeping it would have been a third statement of the
-- same rule.

CREATE OR REPLACE FUNCTION public.enforce_quality_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_quality boolean;
  _is_manager boolean;
  _verdict_changed boolean := new.validation_status IS DISTINCT FROM old.validation_status;
  _closure_changed boolean := (new.closed_at IS NULL) IS DISTINCT FROM (old.closed_at IS NULL);
BEGIN
  IF NOT _verdict_changed AND NOT _closure_changed THEN RETURN new; END IF;

  -- Backend paths (cron, service key) have no auth.uid(); RLS keeps anon out.
  IF _uid IS NULL THEN RETURN new; END IF;

  -- The Permissions page decides, not a list written here. Baselines are the roles
  -- this function named until 20260901090000, so an un-overridden database is
  -- unchanged.
  _is_quality := has_action(_uid, 'quality.validate', ARRAY['admin','quality_supervisor']::app_role[]);
  _is_manager := has_action(_uid, 'quality.close', ARRAY['admin','manager','maintenance_manager']::app_role[]);

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
      -- The evidence check stood here. See 20260827090000: the upload it required was
      -- removed from the screen, so it could only ever refuse.
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

COMMENT ON FUNCTION public.enforce_quality_validation() IS
  'The quality audit gate. Who may rule and who may close is read from the Permissions '
  'page via has_action (quality.validate, quality.close), not from a role list held '
  'here. Since 20260901090000; the baselines are the roles it named before, so an '
  'un-overridden database behaves identically.';
