-- 1. Revert verify_engineer_pin to read from public.engineers (canonical source)
CREATE OR REPLACE FUNCTION public.verify_engineer_pin(_user_id uuid, _pin text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.engineers
    WHERE id = _user_id
      AND is_active = true
      AND pin_hash IS NOT NULL
      AND pin_hash = extensions.crypt(_pin, pin_hash)
  )
$$;

-- 2. Repoint set_engineer_pin to write to public.engineers
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

  UPDATE public.engineers
  SET pin_hash = extensions.crypt(_new_pin, extensions.gen_salt('bf', 10))
  WHERE id = _user_id;
END;
$$;

-- 3. Drop redundant profile-PIN functions
DROP FUNCTION IF EXISTS public.set_profile_pin(uuid, text);
DROP FUNCTION IF EXISTS public.verify_profile_pin(uuid, text);

-- 4. Drop the unused profiles.pin_hash column
ALTER TABLE public.profiles DROP COLUMN IF EXISTS pin_hash;

-- 5. Audit log entry
INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, details)
VALUES (
  NULL,
  'system',
  'security_migration_pin_canonical_revert',
  'profiles',
  jsonb_build_object(
    'description', 'Reverted verify_engineer_pin/set_engineer_pin to public.engineers (canonical). Dropped profiles.pin_hash and profile-pin RPCs.',
    'date', now()
  )
);