-- 1. Add bcrypt-hashed pin_hash column on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pin_hash text;

-- 2. Drop the plaintext pin column (currently empty — safe)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS pin;

-- 3. Lock down direct read access to pin_hash via column-level revoke
REVOKE SELECT (pin_hash) ON public.profiles FROM authenticated;
REVOKE SELECT (pin_hash) ON public.profiles FROM anon;

-- 4. Recreate verify_engineer_pin to use pin_hash
CREATE OR REPLACE FUNCTION public.verify_engineer_pin(_user_id uuid, _pin text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id
      AND pin_hash IS NOT NULL
      AND pin_hash = extensions.crypt(_pin, pin_hash)
  )
$$;

-- 5. Repoint set_engineer_pin to write pin_hash
CREATE OR REPLACE FUNCTION public.set_engineer_pin(_user_id uuid, _new_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF _new_pin IS NULL OR length(_new_pin) < 4 THEN
    RAISE EXCEPTION 'PIN must be at least 4 characters';
  END IF;

  UPDATE public.profiles
  SET pin_hash = extensions.crypt(_new_pin, extensions.gen_salt('bf', 10)),
      updated_at = now()
  WHERE id = _user_id;
END;
$$;

-- 6. Add canonical aliases mirroring the engineers.pin_hash pattern
CREATE OR REPLACE FUNCTION public.set_profile_pin(_user_id uuid, _pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE _actor uuid := auth.uid();
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _user_id <> _actor AND NOT public.has_role(_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: can only set your own PIN';
  END IF;

  IF _pin IS NULL OR length(_pin) < 4 THEN
    RAISE EXCEPTION 'PIN must be at least 4 characters';
  END IF;

  UPDATE public.profiles
  SET pin_hash = extensions.crypt(_pin, extensions.gen_salt('bf', 10)),
      updated_at = now()
  WHERE id = _user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_profile_pin(_user_id uuid, _pin text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE _stored text;
BEGIN
  IF _pin IS NULL OR _pin = '' THEN RETURN false; END IF;

  SELECT pin_hash INTO _stored
    FROM public.profiles
   WHERE id = _user_id;

  IF _stored IS NULL THEN RETURN false; END IF;

  RETURN _stored = extensions.crypt(_pin, _stored);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_profile_pin(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_profile_pin(uuid, text) TO authenticated;

-- 7. Audit trail entry for the migration
INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, details)
VALUES (
  NULL,
  'system',
  'security_migration_pin_hash',
  'profiles',
  jsonb_build_object(
    'description', 'Migrated profiles.pin (plaintext column, empty) to profiles.pin_hash (bcrypt). Repointed verify_engineer_pin and set_engineer_pin.',
    'date', now(),
    'rows_affected', 0
  )
);