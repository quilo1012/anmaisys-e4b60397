-- 1) Revoke direct column-level write access on engineers.pin_hash from authenticated.
-- The guard_engineer_pin_hash trigger already blocks non-admin updates, but this adds
-- defense-in-depth at the column-grant level.
REVOKE UPDATE (pin_hash) ON public.engineers FROM authenticated;
REVOKE INSERT (pin_hash) ON public.engineers FROM authenticated;

-- Service role (used by Edge Functions) retains full access by default.

-- 2) Explicit anon deny on system_settings (belt-and-suspenders; RLS already blocks).
DROP POLICY IF EXISTS "Deny anon access to system_settings" ON public.system_settings;
CREATE POLICY "Deny anon access to system_settings"
ON public.system_settings
AS RESTRICTIVE
FOR ALL
TO anon
USING (false)
WITH CHECK (false);

-- 3) Restrict labor_rate visibility: rewrite manager profile select policy to exclude labor_rate
-- by replacing it with a stricter one. We can't do column-level RLS easily, so we use a
-- column-level revoke for the manager case. Since RLS works at row-level, we use grants:
-- Revoke SELECT on labor_rate from authenticated and re-grant only to admin via a view.
REVOKE SELECT (labor_rate) ON public.profiles FROM authenticated;

-- Helper view that exposes labor_rate only to admins or the owner.
-- Use existing get_own_labor_rate() and get_profile_labor_rate() RPCs instead of direct column access.
-- This forces all labor_rate reads to go through the SECURITY DEFINER functions which already enforce admin-only.

-- Note: anon already has no GRANTs on profiles.