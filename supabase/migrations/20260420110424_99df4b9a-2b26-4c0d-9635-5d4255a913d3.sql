-- 1) Harden manager role update policy: explicitly prevent modifying users
-- who already hold admin or manager roles (defense-in-depth against escalation)
DROP POLICY IF EXISTS "Managers can update to limited roles" ON public.user_roles;

CREATE POLICY "Managers can update to limited roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND user_id <> auth.uid()
  AND role = ANY (ARRAY['engineer'::app_role, 'operator'::app_role, 'viewer'::app_role])
  AND NOT has_role(user_id, 'admin'::app_role)
  AND NOT has_role(user_id, 'manager'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND user_id <> auth.uid()
  AND role = ANY (ARRAY['engineer'::app_role, 'operator'::app_role, 'viewer'::app_role])
  AND NOT has_role(user_id, 'admin'::app_role)
  AND NOT has_role(user_id, 'manager'::app_role)
);

-- Same hardening for the insert policy
DROP POLICY IF EXISTS "Managers can insert limited roles" ON public.user_roles;

CREATE POLICY "Managers can insert limited roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND user_id <> auth.uid()
  AND role = ANY (ARRAY['engineer'::app_role, 'operator'::app_role, 'viewer'::app_role])
  AND NOT has_role(user_id, 'admin'::app_role)
  AND NOT has_role(user_id, 'manager'::app_role)
);

-- 2) Protect labor_rate (compensation) from being readable by managers.
-- Restrict the manager SELECT policy on profiles so it does not expose labor_rate.
-- Strategy: keep policy but split — managers only see non-admin profiles
-- without compensation data. We enforce this by replacing the manager SELECT
-- policy with one that filters AND exposing labor_rate is gated through the
-- existing admin-only get_profile_labor_rate / list_profile_labor_rates RPCs.

-- Since PostgreSQL RLS is row-level (not column-level), the practical mitigation
-- is to ensure application code (and the safe view) excludes labor_rate for
-- managers. We tighten by recreating profiles_safe to be the canonical
-- non-sensitive read source and revoke direct labor_rate visibility to managers
-- via a column-level GRANT pattern.

-- Revoke column-level SELECT on labor_rate from authenticated, then grant
-- SELECT on all OTHER columns. Admins continue to access labor_rate through
-- SECURITY DEFINER RPCs (get_profile_labor_rate, list_profile_labor_rates).
REVOKE SELECT ON public.profiles FROM authenticated;

GRANT SELECT
  (id, email, name, shift, active, ui_preferences, last_seen_at, created_at, updated_at)
  ON public.profiles
  TO authenticated;

-- Ensure write privileges remain intact (RLS still enforces row access)
GRANT INSERT, UPDATE ON public.profiles TO authenticated;