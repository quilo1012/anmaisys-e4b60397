-- SECURITY (Critical): managers/supervisors could read other employees' pay rate.
-- A table-level SELECT grant on `profiles` covers EVERY column, so the earlier
-- column REVOKE on labor_rate had no effect. Fix it properly: drop the table-level
-- SELECT and grant column-level SELECT on every column EXCEPT labor_rate.
--
-- RLS still decides which ROWS each role sees. Pay rate stays readable only through
-- the admin/self SECURITY DEFINER RPCs (get_own_labor_rate / get_profile_labor_rate
-- / list_profile_labor_rates), which run as owner and bypass these grants.
--
-- NOTE: column-level grants do NOT auto-include future columns — when a new column
-- is added to `profiles`, GRANT SELECT on it here too (unless it's also sensitive).
REVOKE SELECT ON public.profiles FROM authenticated, anon;
GRANT SELECT (id, name, email, shift, active, production_line, ui_preferences, last_seen_at, created_at, updated_at)
  ON public.profiles TO authenticated;

-- Defense-in-depth: engineers.labor_rate. Direct reads are already fully blocked by
-- RLS ("No direct engineer reads" = false); this also drops any column-level read.
REVOKE SELECT (labor_rate) ON public.engineers FROM authenticated, anon;

-- SECURITY (Warning): pin a non-mutable search_path on the banner helper function.
ALTER FUNCTION public._norm_img(text) SET search_path = '';
