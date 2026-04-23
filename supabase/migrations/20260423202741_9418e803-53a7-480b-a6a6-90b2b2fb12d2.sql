-- Revoke column-level SELECT on sensitive PIN hash columns to prevent
-- any client query (even by admins/managers) from retrieving the bcrypt hashes.
-- All legitimate PIN operations go through SECURITY DEFINER RPCs.

REVOKE SELECT (pin_hash) ON public.engineers FROM anon, authenticated;
REVOKE SELECT (admin_pin) ON public.system_settings FROM anon, authenticated;

-- Re-grant SELECT on every other column of engineers so admins/managers can
-- still read the table (excluding pin_hash).
GRANT SELECT (id, name, is_active, created_at) ON public.engineers TO authenticated;

-- Re-grant SELECT on every other column of system_settings.
GRANT SELECT (id, created_at, updated_at) ON public.system_settings TO authenticated;