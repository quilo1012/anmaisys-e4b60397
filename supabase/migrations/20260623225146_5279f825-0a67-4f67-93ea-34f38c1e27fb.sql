
-- 1) Attempts table (internal — only touched by the SECURITY DEFINER function)
CREATE TABLE IF NOT EXISTS public.pin_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  failures     integer NOT NULL DEFAULT 0,
  lockout_step integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT ALL ON public.pin_attempts TO service_role;
-- Intentionally no grants to anon/authenticated — only the SECURITY DEFINER
-- function below is allowed to read/write this table.

ALTER TABLE public.pin_attempts ENABLE ROW LEVEL SECURITY;
-- No policies => locked down. SECURITY DEFINER functions bypass RLS.

-- 2) Server-side rate-limited PIN verifier.
CREATE OR REPLACE FUNCTION public.verify_pin_with_lockout(_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _now timestamptz := now();
  _row public.pin_attempts%ROWTYPE;
  _eng record;
  _step integer;
  _wait integer;
  _max_free constant integer := 5;
  -- 30s, 60s, 120s, 300s (then stays at 300s)
  _ladder constant integer[] := ARRAY[30, 60, 120, 300];
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- Use a stable identity for unauthenticated sessions too (tablet shared
  -- accounts are still authenticated as the operator user).
  SELECT * INTO _row FROM public.pin_attempts WHERE user_id = _uid FOR UPDATE;

  -- Currently locked? Refuse without checking the PIN.
  IF _row.locked_until IS NOT NULL AND _row.locked_until > _now THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'locked',
      'locked_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_row.locked_until - _now)))::int),
      'remaining', 0
    );
  END IF;

  -- Verify the PIN against the engineers table.
  SELECT e.id, e.name INTO _eng
  FROM public.engineers e
  WHERE e.is_active = true
    AND e.pin_hash IS NOT NULL
    AND e.pin_hash = extensions.crypt(_pin, e.pin_hash)
  LIMIT 1;

  IF _eng.id IS NOT NULL THEN
    -- Success — wipe the counter for this user.
    DELETE FROM public.pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object(
      'success', true,
      'engineer_id', _eng.id,
      'engineer_name', _eng.name
    );
  END IF;

  -- Failure — bump counter, possibly engage the next lockout step.
  IF _row.user_id IS NULL THEN
    INSERT INTO public.pin_attempts (user_id, failures, lockout_step, last_attempt, updated_at)
    VALUES (_uid, 1, 0, _now, _now)
    RETURNING * INTO _row;
  ELSE
    UPDATE public.pin_attempts
       SET failures = _row.failures + 1,
           last_attempt = _now,
           updated_at = _now
     WHERE user_id = _uid
    RETURNING * INTO _row;
  END IF;

  IF _row.failures >= _max_free THEN
    _step := LEAST(_row.lockout_step + 1, array_length(_ladder, 1));
    _wait := _ladder[_step];
    UPDATE public.pin_attempts
       SET lockout_step = _step,
           locked_until = _now + make_interval(secs => _wait),
           failures = 0,
           updated_at = _now
     WHERE user_id = _uid;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'locked',
      'locked_seconds', _wait,
      'remaining', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'error', 'invalid_pin',
    'remaining', _max_free - _row.failures
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.verify_pin_with_lockout(text) TO authenticated;
