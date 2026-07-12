
ALTER TABLE public.leader_pins ADD COLUMN IF NOT EXISTS lines text[] NOT NULL DEFAULT '{}';

-- Backfill from legacy `line` scalar
UPDATE public.leader_pins
SET lines = ARRAY[line]
WHERE (lines IS NULL OR array_length(lines,1) IS NULL)
  AND line IS NOT NULL AND length(trim(line)) > 0;

DROP FUNCTION IF EXISTS public.list_leaders();
CREATE OR REPLACE FUNCTION public.list_leaders()
RETURNS TABLE(id uuid, name text, is_active boolean, line text, lines text[], created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT l.id, l.name, l.is_active, l.line, COALESCE(l.lines,'{}'::text[]), l.created_at FROM public.leader_pins l ORDER BY l.name; $$;
REVOKE EXECUTE ON FUNCTION public.list_leaders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_leaders() TO authenticated;

DROP FUNCTION IF EXISTS public.create_leader(text, text, text);
CREATE OR REPLACE FUNCTION public.create_leader(_name text, _pin text, _lines text[] DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE _id uuid; _clean text[];
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') AND NOT public.has_role(auth.uid(),'manager') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT COALESCE(array_agg(DISTINCT trim(x)) FILTER (WHERE trim(x) <> ''), '{}')
    INTO _clean FROM unnest(COALESCE(_lines,'{}'::text[])) AS x;
  INSERT INTO public.leader_pins(name, pin_hash, line, lines)
  VALUES (trim(_name), extensions.crypt(_pin, extensions.gen_salt('bf', 10)),
          NULLIF(_clean[1],''), _clean)
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.create_leader(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_leader(text, text, text[]) TO authenticated;

DROP FUNCTION IF EXISTS public.update_leader(uuid, text, boolean, text, text);
CREATE OR REPLACE FUNCTION public.update_leader(
  _id uuid, _name text DEFAULT NULL, _active boolean DEFAULT NULL,
  _pin text DEFAULT NULL, _lines text[] DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE _clean text[];
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') AND NOT public.has_role(auth.uid(),'manager') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _name IS NOT NULL THEN UPDATE public.leader_pins SET name = trim(_name) WHERE id = _id; END IF;
  IF _active IS NOT NULL THEN UPDATE public.leader_pins SET is_active = _active WHERE id = _id; END IF;
  IF _pin IS NOT NULL AND length(_pin) >= 4 THEN
    UPDATE public.leader_pins SET pin_hash = extensions.crypt(_pin, extensions.gen_salt('bf', 10)) WHERE id = _id;
  END IF;
  IF _lines IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT trim(x)) FILTER (WHERE trim(x) <> ''), '{}')
      INTO _clean FROM unnest(_lines) AS x;
    UPDATE public.leader_pins SET lines = _clean, line = NULLIF(_clean[1],'') WHERE id = _id;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.update_leader(uuid, text, boolean, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_leader(uuid, text, boolean, text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_pin_with_lockout(_pin text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _now timestamptz := now();
  _row public.pin_attempts%ROWTYPE;
  _eng record; _leader record;
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
