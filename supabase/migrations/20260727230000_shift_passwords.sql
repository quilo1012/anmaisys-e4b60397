-- Per-shift passwords: each factory shift (DAY / NIGHT) has its own password.
-- To view a shift's production the user types that shift's password. Passwords
-- are bcrypt-hashed (never stored in clear); the hash is never exposed to the
-- client — access is only via SECURITY DEFINER functions. Applied live; kept
-- for the record.
CREATE TABLE IF NOT EXISTS public.shift_passwords (
  shift_code text PRIMARY KEY CHECK (shift_code IN ('DAY','NIGHT')),
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.shift_passwords ENABLE ROW LEVEL SECURITY;
-- No RLS policies: the table is reachable only through the functions below.
REVOKE ALL ON public.shift_passwords FROM anon, authenticated;

-- Admin sets/changes a shift password (bcrypt via pgcrypto).
CREATE OR REPLACE FUNCTION public.set_shift_password(_shift_code text, _password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admin can set shift passwords';
  END IF;
  IF upper(_shift_code) NOT IN ('DAY','NIGHT') THEN
    RAISE EXCEPTION 'Invalid shift code';
  END IF;
  IF _password IS NULL OR length(_password) < 3 THEN
    RAISE EXCEPTION 'Password too short';
  END IF;
  INSERT INTO public.shift_passwords(shift_code, password_hash, updated_by)
  VALUES (upper(_shift_code), extensions.crypt(_password, extensions.gen_salt('bf')), auth.uid())
  ON CONFLICT (shift_code) DO UPDATE
    SET password_hash = EXCLUDED.password_hash, updated_at = now(), updated_by = auth.uid();
END;
$$;

-- Verify a shift password. Returns true when no password is configured yet, so
-- nobody is locked out before an admin sets one.
CREATE OR REPLACE FUNCTION public.verify_shift_password(_shift_code text, _password text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE h text;
BEGIN
  SELECT password_hash INTO h FROM public.shift_passwords WHERE shift_code = upper(_shift_code);
  IF h IS NULL THEN RETURN true; END IF;
  RETURN h = extensions.crypt(_password, h);
END;
$$;

-- Whether a shift has a password configured (so the UI knows to show the lock),
-- without exposing the hash.
CREATE OR REPLACE FUNCTION public.shift_password_is_set(_shift_code text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.shift_passwords WHERE shift_code = upper(_shift_code));
$$;

REVOKE ALL ON FUNCTION public.set_shift_password(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_shift_password(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shift_password_is_set(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_shift_password(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_shift_password(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shift_password_is_set(text) TO authenticated;
