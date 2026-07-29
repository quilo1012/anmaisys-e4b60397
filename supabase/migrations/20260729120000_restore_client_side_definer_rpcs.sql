-- Fix: RLS_ERROR "permission denied for function get_profile_labor_rate"
--
-- 20260628170000 revoked EXECUTE from `authenticated` on a batch of SECURITY
-- DEFINER RPCs on the assumption they were all Edge-Function-only. Two of them
-- are in fact called straight from the browser, so the revoke broke live
-- features:
--
--   1. get_profile_labor_rate(uuid) — WorkOrderDetail's admin cost breakdown.
--      Every admin opening /dashboard/wo/<id> logs an RLS_ERROR and the labour
--      cost silently reads as £0.
--   2. set_engineer_pin(uuid, text) — EngineerChangePinDialog ("Change Your
--      PIN"), which has been failing for every engineer since that migration.
--
-- get_profile_labor_rate already enforces `has_role(auth.uid(), 'admin')`
-- internally and runs as owner, exactly like its still-granted sibling
-- list_profile_labor_rates. Re-granting EXECUTE does not widen access to
-- profiles.labor_rate: the column GRANT stays revoked (20260724130000).
GRANT EXECUTE ON FUNCTION public.get_profile_labor_rate(uuid) TO authenticated;

-- set_engineer_pin(uuid, text) is NOT safe to re-grant: it takes the target
-- user id as an argument and has no caller check, so any authenticated user
-- could overwrite any engineer's PIN. Keep it service-role-only and give the
-- browser a self-service variant that derives the target from the JWT.
CREATE OR REPLACE FUNCTION public.set_own_engineer_pin(_new_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  -- Same validation as set_engineer_pin, so behaviour is unchanged for callers.
  IF _new_pin IS NULL OR length(_new_pin) < 4 THEN
    RAISE EXCEPTION 'PIN must be at least 4 characters';
  END IF;

  UPDATE public.engineers
  SET pin_hash = extensions.crypt(_new_pin, extensions.gen_salt('bf', 10))
  WHERE id = _uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No engineer record for the current user';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_own_engineer_pin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_own_engineer_pin(text) TO authenticated;

COMMENT ON FUNCTION public.set_own_engineer_pin(text) IS
  'Self-service PIN change for the calling user. Browser-safe replacement for set_engineer_pin(uuid, text), which stays service-role-only because it accepts an arbitrary target id.';
