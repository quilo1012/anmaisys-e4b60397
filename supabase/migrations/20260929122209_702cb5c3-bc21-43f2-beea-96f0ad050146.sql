CREATE TABLE IF NOT EXISTS public.admin_pin_attempts (
  user_id uuid PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  lockout_step integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_pin_attempts TO service_role;
ALTER TABLE public.admin_pin_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.verify_admin_pin_with_lockout(_pin text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _now timestamptz := now();
  _row public.admin_pin_attempts%ROWTYPE;
  _ok boolean; _step integer; _wait integer;
  _max_free constant integer := 5;
  _ladder constant integer[] := ARRAY[30, 60, 120, 300];
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  SELECT * INTO _row FROM public.admin_pin_attempts WHERE user_id = _uid FOR UPDATE;
  IF _row.locked_until IS NOT NULL AND _row.locked_until > _now THEN
    RETURN jsonb_build_object('success', false, 'error', 'locked',
      'locked_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_row.locked_until - _now)))::int), 'remaining', 0);
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.system_settings WHERE admin_pin = extensions.crypt(_pin, admin_pin)) INTO _ok;
  IF _ok THEN
    DELETE FROM public.admin_pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object('success', true);
  END IF;
  INSERT INTO public.admin_pin_attempts (user_id, failures, lockout_step, last_attempt, updated_at)
  VALUES (_uid, 1, 0, _now, _now)
  ON CONFLICT (user_id) DO UPDATE SET failures = admin_pin_attempts.failures + 1, last_attempt = _now, updated_at = _now
  RETURNING * INTO _row;
  IF _row.failures > _max_free THEN
    _step := LEAST(_row.failures - _max_free, array_length(_ladder, 1));
    _wait := _ladder[_step];
    UPDATE public.admin_pin_attempts SET locked_until = _now + make_interval(secs => _wait), lockout_step = _step WHERE user_id = _uid;
    RETURN jsonb_build_object('success', false, 'error', 'locked', 'locked_seconds', _wait, 'remaining', 0);
  END IF;
  RETURN jsonb_build_object('success', false, 'error', 'invalid_pin', 'remaining', GREATEST(0, _max_free - _row.failures));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.verify_admin_pin_with_lockout(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_pin_with_lockout(text) TO authenticated;