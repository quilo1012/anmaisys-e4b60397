
-- Fix verify_admin_pin to use extensions schema for crypt
CREATE OR REPLACE FUNCTION public.verify_admin_pin(_pin text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM system_settings
    WHERE admin_pin = crypt(_pin, admin_pin)
    LIMIT 1
  )
$$;

-- Fix set_admin_pin to use extensions schema for crypt/gen_salt
CREATE OR REPLACE FUNCTION public.set_admin_pin(_new_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE system_settings
  SET admin_pin = crypt(_new_pin, gen_salt('bf')),
      updated_at = now();
END;
$$;
