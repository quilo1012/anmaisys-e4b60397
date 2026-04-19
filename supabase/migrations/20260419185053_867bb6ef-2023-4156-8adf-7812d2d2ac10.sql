
-- Re-apply column-level revokes to harden sensitive fields.
-- These are idempotent and ensure pin_hash and labor_rate are not selectable
-- by any non-admin client, even if a permissive table-level GRANT is recreated.

-- 1. engineers.pin_hash — NEVER selectable through PostgREST.
REVOKE SELECT (pin_hash) ON public.engineers FROM PUBLIC;
REVOKE SELECT (pin_hash) ON public.engineers FROM anon;
REVOKE SELECT (pin_hash) ON public.engineers FROM authenticated;

-- Also revoke UPDATE on pin_hash so it can only be modified through SECURITY DEFINER RPCs.
REVOKE UPDATE (pin_hash) ON public.engineers FROM PUBLIC;
REVOKE UPDATE (pin_hash) ON public.engineers FROM anon;
REVOKE UPDATE (pin_hash) ON public.engineers FROM authenticated;

-- 2. profiles.labor_rate — only accessible via admin-only RPCs.
REVOKE SELECT (labor_rate) ON public.profiles FROM PUBLIC;
REVOKE SELECT (labor_rate) ON public.profiles FROM anon;
REVOKE SELECT (labor_rate) ON public.profiles FROM authenticated;

REVOKE UPDATE (labor_rate) ON public.profiles FROM PUBLIC;
REVOKE UPDATE (labor_rate) ON public.profiles FROM anon;
REVOKE UPDATE (labor_rate) ON public.profiles FROM authenticated;

-- Re-grant SELECT/UPDATE on all OTHER columns of engineers to authenticated
-- (RLS policies still apply on top of this).
GRANT SELECT (id, name, is_active, created_at) ON public.engineers TO authenticated;
GRANT INSERT (id, name, is_active, created_at) ON public.engineers TO authenticated;
GRANT UPDATE (name, is_active) ON public.engineers TO authenticated;

-- Re-grant SELECT/UPDATE on all OTHER columns of profiles to authenticated.
GRANT SELECT (id, name, email, active, shift, ui_preferences, last_seen_at, created_at, updated_at)
  ON public.profiles TO authenticated;
GRANT UPDATE (name, email, active, shift, ui_preferences, last_seen_at)
  ON public.profiles TO authenticated;
GRANT INSERT (id, name, email, active, shift, ui_preferences, last_seen_at)
  ON public.profiles TO authenticated;
