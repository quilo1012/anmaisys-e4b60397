-- Shared "reveal target" PIN for the operator My Production screen.
--
-- The shift target used to show openly ("Remaining X of TARGET"). It's now
-- hidden and revealed only with a PIN. Per requirement the PIN is NOT leader-
-- exclusive: any signed-in user who knows the single shared company PIN can
-- reveal it. verify_admin_pin can't serve this because it's gated to admins.
--
-- This reuses the one admin_pin as that shared secret and verifies it for any
-- authenticated user. SECURITY DEFINER so the hash is never exposed client-side;
-- it only ever returns a boolean.
CREATE OR REPLACE FUNCTION public.verify_target_pin(_pin text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.system_settings
    WHERE admin_pin IS NOT NULL
      AND admin_pin = extensions.crypt(_pin, admin_pin)
    LIMIT 1
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.verify_target_pin(text) TO authenticated;
