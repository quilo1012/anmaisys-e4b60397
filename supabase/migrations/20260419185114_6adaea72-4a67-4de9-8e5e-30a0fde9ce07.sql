
-- Column-level REVOKEs are ignored when a table-level GRANT exists.
-- We must REVOKE table-level SELECT/UPDATE first, then GRANT only the safe columns.

-- ENGINEERS
REVOKE SELECT, UPDATE, INSERT ON public.engineers FROM authenticated;
REVOKE SELECT, UPDATE, INSERT ON public.engineers FROM anon;

GRANT SELECT (id, name, is_active, created_at) ON public.engineers TO authenticated;
GRANT INSERT (id, name, is_active) ON public.engineers TO authenticated;
GRANT UPDATE (name, is_active) ON public.engineers TO authenticated;
-- DELETE is row-level only (no column granularity); RLS policies still control it.
GRANT DELETE ON public.engineers TO authenticated;

-- PROFILES
REVOKE SELECT, UPDATE, INSERT ON public.profiles FROM authenticated;
REVOKE SELECT, UPDATE, INSERT ON public.profiles FROM anon;

GRANT SELECT (id, name, email, active, shift, ui_preferences, last_seen_at, created_at, updated_at)
  ON public.profiles TO authenticated;
GRANT INSERT (id, name, email, active, shift, ui_preferences, last_seen_at)
  ON public.profiles TO authenticated;
GRANT UPDATE (name, email, active, shift, ui_preferences, last_seen_at)
  ON public.profiles TO authenticated;
