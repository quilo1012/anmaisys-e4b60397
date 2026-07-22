-- Per-tablet/line operator PIN.
--
-- Adds a PIN to operator_line_accounts (one row per tablet/line identity) so an
-- operator can unlock their own production Target without a leader PIN. Reuses
-- the existing verify_pin_with_lockout RPC + pin_attempts lockout ledger.

ALTER TABLE public.operator_line_accounts ADD COLUMN IF NOT EXISTS pin_hash text;

-- Never expose the hash to clients (mirrors the old profiles.pin pattern).
REVOKE SELECT (pin_hash) ON public.operator_line_accounts FROM authenticated;

-- Admin/manager set (or clear) a tablet/line PIN.
CREATE OR REPLACE FUNCTION public.set_operator_pin(_id uuid, _pin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') AND NOT public.has_role(auth.uid(),'manager') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _pin IS NULL OR length(trim(_pin)) = 0 THEN
    -- Clear the PIN.
    UPDATE public.operator_line_accounts SET pin_hash = NULL, updated_at = now() WHERE id = _id;
    RETURN;
  END IF;
  IF length(trim(_pin)) < 4 THEN
    RAISE EXCEPTION 'pin_too_short';
  END IF;
  UPDATE public.operator_line_accounts
     SET pin_hash = extensions.crypt(_pin, extensions.gen_salt('bf', 10)),
         updated_at = now()
   WHERE id = _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_operator_pin(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_operator_pin(uuid, text) TO authenticated;

-- Extend the canonical verifier with an operator branch (checks the CALLER's own
-- account). Full re-definition preserving the engineer + leader branches.
CREATE OR REPLACE FUNCTION public.verify_pin_with_lockout(_pin text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _now timestamptz := now();
  _row public.pin_attempts%ROWTYPE;
  _eng record; _leader record; _op record;
  _step integer; _wait integer;
  _max_free constant integer := 5;
  _ladder constant integer[] := ARRAY[30, 60, 120, 300];
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_authenticated'); END IF;
  SELECT * INTO _row FROM public.pin_attempts WHERE user_id = _uid FOR UPDATE;
  IF _row.locked_until IS NOT NULL AND _row.locked_until > _now THEN
    RETURN jsonb_build_object('success', false, 'error', 'locked',
      'locked_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_row.locked_until - _now)))::int),
      'remaining', 0);
  END IF;

  SELECT e.id, e.name INTO _eng FROM public.engineers e
   WHERE e.is_active = true AND e.pin_hash IS NOT NULL
     AND e.pin_hash = extensions.crypt(_pin, e.pin_hash) LIMIT 1;
  IF _eng.id IS NOT NULL THEN
    DELETE FROM public.pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object('success', true, 'engineer_id', _eng.id,
      'engineer_name', _eng.name, 'is_leader', false);
  END IF;

  SELECT l.id, l.name, l.line, COALESCE(l.lines,'{}'::text[]) AS lines INTO _leader FROM public.leader_pins l
   WHERE l.is_active = true AND l.pin_hash IS NOT NULL
     AND l.pin_hash = extensions.crypt(_pin, l.pin_hash) LIMIT 1;
  IF _leader.id IS NOT NULL THEN
    DELETE FROM public.pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object('success', true, 'engineer_id', _leader.id,
      'engineer_name', _leader.name, 'is_leader', true,
      'leader_line', _leader.line, 'leader_lines', to_jsonb(_leader.lines));
  END IF;

  -- Operator (tablet/line) PIN: only the caller's OWN account.
  SELECT o.id, o.label, COALESCE(o.line_ids,'{}'::uuid[]) AS line_ids INTO _op
    FROM public.operator_line_accounts o
   WHERE o.user_id = _uid AND o.pin_hash IS NOT NULL
     AND o.pin_hash = extensions.crypt(_pin, o.pin_hash) LIMIT 1;
  IF _op.id IS NOT NULL THEN
    DELETE FROM public.pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object('success', true, 'is_operator', true,
      'account_id', _op.id, 'operator_label', _op.label,
      'line_ids', to_jsonb(_op.line_ids));
  END IF;

  IF _row.user_id IS NULL THEN
    INSERT INTO public.pin_attempts (user_id, failures, lockout_step, last_attempt, updated_at)
    VALUES (_uid, 1, 0, _now, _now) RETURNING * INTO _row;
  ELSE
    UPDATE public.pin_attempts SET failures = _row.failures + 1, last_attempt = _now, updated_at = _now
      WHERE user_id = _uid RETURNING * INTO _row;
  END IF;

  IF _row.failures > _max_free THEN
    _step := LEAST(_row.failures - _max_free, array_length(_ladder,1));
    _wait := _ladder[_step];
    UPDATE public.pin_attempts SET locked_until = _now + make_interval(secs => _wait), lockout_step = _step
      WHERE user_id = _uid;
    RETURN jsonb_build_object('success', false, 'error', 'locked', 'locked_seconds', _wait, 'remaining', 0);
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'invalid_pin',
    'remaining', GREATEST(0, _max_free - _row.failures));
END $function$;
