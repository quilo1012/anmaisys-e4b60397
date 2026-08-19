-- "Attach the evidence before validating this action." — there is nowhere left to
-- attach it.
--
-- The rule was right when it was written (20260730230000, ALCOA+: a validated
-- deviation carries its evidence) because the detail dialog had a Photos block with an
-- upload beside it. Both are gone from the screen: attachments for a deviation are
-- captured in SafetyCulture now, and the verdict picker went with them. A trigger that
-- demands a file no screen can produce does not enforce a standard, it just refuses
-- every write and teaches whoever hits it that the app is broken.
--
-- Nothing else in the function changes. Only Quality still rules on a deviation, a
-- closed action still has to be reopened before its verdict moves, closure is still a
-- manager's and still needs a verdict first. The `attachments` column is untouched and
-- every path already in it stays exactly where it is — this drops the gate, not the
-- evidence.
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
      -- The evidence check stood here. See the header: the upload it required was
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
