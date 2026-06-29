
-- 1) Table
CREATE TABLE IF NOT EXISTS public.leader_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  pin_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leader_pins TO authenticated;
GRANT ALL ON public.leader_pins TO service_role;

ALTER TABLE public.leader_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage leader_pins"
  ON public.leader_pins FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_leader_pins_updated
  BEFORE UPDATE ON public.leader_pins
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Admin RPCs (avoid exposing pin_hash, hash server-side)
CREATE OR REPLACE FUNCTION public.list_leaders()
RETURNS TABLE(id uuid, name text, is_active boolean, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY SELECT l.id, l.name, l.is_active, l.created_at FROM public.leader_pins l ORDER BY l.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_leader(_name text, _pin text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;
  IF _name IS NULL OR length(trim(_name)) = 0 THEN RAISE EXCEPTION 'Name required'; END IF;
  IF _pin !~ '^\d{4}$' THEN RAISE EXCEPTION 'PIN must be 4 digits'; END IF;
  INSERT INTO public.leader_pins(name, pin_hash)
  VALUES (trim(_name), extensions.crypt(_pin, extensions.gen_salt('bf', 10)))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_leader(_id uuid, _name text DEFAULT NULL, _active boolean DEFAULT NULL, _pin text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;
  IF _name IS NOT NULL THEN
    UPDATE public.leader_pins SET name = trim(_name) WHERE id = _id;
  END IF;
  IF _active IS NOT NULL THEN
    UPDATE public.leader_pins SET is_active = _active WHERE id = _id;
  END IF;
  IF _pin IS NOT NULL THEN
    IF _pin !~ '^\d{4}$' THEN RAISE EXCEPTION 'PIN must be 4 digits'; END IF;
    UPDATE public.leader_pins SET pin_hash = extensions.crypt(_pin, extensions.gen_salt('bf', 10)) WHERE id = _id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_leader(_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;
  DELETE FROM public.leader_pins WHERE id = _id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_leaders() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_leader(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_leader(uuid, text, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_leader(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_leaders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_leader(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_leader(uuid, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_leader(uuid) TO authenticated;

-- 3) Update verify_pin_with_lockout to also accept leader PINs.
-- Returns the matched identity; leader matches return is_leader=true.
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
  _leader record;
  _step integer;
  _wait integer;
  _max_free constant integer := 5;
  _ladder constant integer[] := ARRAY[30, 60, 120, 300];
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO _row FROM public.pin_attempts WHERE user_id = _uid FOR UPDATE;

  IF _row.locked_until IS NOT NULL AND _row.locked_until > _now THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'locked',
      'locked_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_row.locked_until - _now)))::int),
      'remaining', 0
    );
  END IF;

  -- Try engineer first
  SELECT e.id, e.name INTO _eng
  FROM public.engineers e
  WHERE e.is_active = true
    AND e.pin_hash IS NOT NULL
    AND e.pin_hash = extensions.crypt(_pin, e.pin_hash)
  LIMIT 1;

  IF _eng.id IS NOT NULL THEN
    DELETE FROM public.pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object(
      'success', true,
      'engineer_id', _eng.id,
      'engineer_name', _eng.name,
      'is_leader', false
    );
  END IF;

  -- Try leader
  SELECT l.id, l.name INTO _leader
  FROM public.leader_pins l
  WHERE l.is_active = true
    AND l.pin_hash IS NOT NULL
    AND l.pin_hash = extensions.crypt(_pin, l.pin_hash)
  LIMIT 1;

  IF _leader.id IS NOT NULL THEN
    DELETE FROM public.pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object(
      'success', true,
      'engineer_id', _leader.id,
      'engineer_name', _leader.name,
      'is_leader', true
    );
  END IF;

  -- Failure
  IF _row.user_id IS NULL THEN
    INSERT INTO public.pin_attempts (user_id, failures, lockout_step, last_attempt, updated_at)
    VALUES (_uid, 1, 0, _now, _now)
    RETURNING * INTO _row;
  ELSE
    UPDATE public.pin_attempts
       SET failures = _row.failures + 1, last_attempt = _now, updated_at = _now
     WHERE user_id = _uid
    RETURNING * INTO _row;
  END IF;

  IF _row.failures >= _max_free THEN
    _step := LEAST(_row.lockout_step + 1, array_length(_ladder, 1));
    _wait := _ladder[_step];
    UPDATE public.pin_attempts
       SET lockout_step = _step, locked_until = _now + make_interval(secs => _wait), failures = 0, updated_at = _now
     WHERE user_id = _uid;
    RETURN jsonb_build_object('success', false, 'error', 'locked', 'locked_seconds', _wait, 'remaining', 0);
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'invalid_pin', 'remaining', _max_free - _row.failures);
END;
$function$;
