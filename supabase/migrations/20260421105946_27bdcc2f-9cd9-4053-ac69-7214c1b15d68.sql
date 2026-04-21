-- 1) Engineers: remove broad admin SELECT, keep management without exposing pin_hash via direct SELECT
DROP POLICY IF EXISTS "Admins can view all engineers" ON public.engineers;

-- Revoke direct column-level SELECT on pin_hash for all roles
REVOKE SELECT (pin_hash) ON public.engineers FROM anon, authenticated, public;

-- Allow admins/managers to read non-sensitive columns only (id, name, is_active, created_at)
-- Note: They keep ALL/manage rights via existing policies but cannot SELECT pin_hash column.
GRANT SELECT (id, name, is_active, created_at) ON public.engineers TO authenticated;

-- 2) System settings: revoke direct read of admin_pin
REVOKE SELECT (admin_pin) ON public.system_settings FROM anon, authenticated, public;
GRANT SELECT (id, created_at, updated_at) ON public.system_settings TO authenticated;