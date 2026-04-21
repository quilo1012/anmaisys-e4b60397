-- 1. Lock down admin_pin column on system_settings
-- Admins can still manage the row (update via set_admin_pin, verify via verify_admin_pin),
-- but the raw bcrypt hash is no longer returned in SELECT queries.
REVOKE SELECT (admin_pin) ON public.system_settings FROM authenticated, anon, public;

-- 2. Lock down labor_rate column on profiles
-- Managers should not see salary data. Admins access via security-definer RPCs.
-- Users may still read their own labor_rate (own-row policy still applies at row level,
-- but to be safe we revoke broad column SELECT and re-grant only what is needed).
REVOKE SELECT (labor_rate) ON public.profiles FROM authenticated, anon, public;

-- Re-grant SELECT on all OTHER profile columns to authenticated so existing
-- "Users can view own profile" / "Managers can view non-admin profiles" policies keep working.
GRANT SELECT (
  id, name, email, shift, active, created_at, updated_at,
  ui_preferences, last_seen_at
) ON public.profiles TO authenticated;

-- Allow users to read their OWN labor_rate (used by some self-service screens), via a
-- security-definer helper. Admins already have list_profile_labor_rates / get_profile_labor_rate.
CREATE OR REPLACE FUNCTION public.get_own_labor_rate()
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(labor_rate, 0) FROM public.profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_own_labor_rate() TO authenticated;