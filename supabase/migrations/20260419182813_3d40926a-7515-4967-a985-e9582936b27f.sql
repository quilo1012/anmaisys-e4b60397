
-- =========================================================================
-- Security hardening: hide engineers.pin_hash from managers and
-- restrict profiles.labor_rate visibility/updates to admins only.
-- =========================================================================

-- ---------------------------------------------------------------------
-- 1. ENGINEERS — remove pin_hash exposure to managers
-- ---------------------------------------------------------------------
-- Drop the broad "Managers can manage engineers" policy (covers SELECT too)
DROP POLICY IF EXISTS "Managers can manage engineers" ON public.engineers;

-- Re-create manager privileges WITHOUT SELECT access to the base table.
-- Managers can still create/update/delete engineer records, but to read
-- them they must use the engineers_safe view (which excludes pin_hash).
CREATE POLICY "Managers can insert engineers"
  ON public.engineers FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Managers can update engineers"
  ON public.engineers FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Managers can delete engineers"
  ON public.engineers FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- Belt-and-suspenders: revoke direct column access to pin_hash for the
-- authenticated role so even a future permissive policy cannot leak it.
REVOKE SELECT (pin_hash) ON public.engineers FROM authenticated;
REVOKE SELECT (pin_hash) ON public.engineers FROM anon;

-- ---------------------------------------------------------------------
-- 2. PROFILES — restrict labor_rate to admins only
-- ---------------------------------------------------------------------
-- Revoke labor_rate column SELECT/UPDATE from non-admins.
-- We do this by revoking from authenticated then granting back the safe
-- columns. Admin reads still work via the SECURITY DEFINER service role
-- and via the admin clause in existing RLS policies (RLS is checked,
-- but column GRANTs are also enforced — so we keep labor_rate readable
-- only when accessed via SECURITY DEFINER functions or by service_role).

-- Block direct column SELECT/UPDATE on labor_rate for the authenticated role.
REVOKE SELECT (labor_rate), UPDATE (labor_rate) ON public.profiles FROM authenticated;
REVOKE SELECT (labor_rate), UPDATE (labor_rate) ON public.profiles FROM anon;

-- Drop labor_rate from the public-facing safe view used by managers.
DROP VIEW IF EXISTS public.profiles_safe CASCADE;
CREATE VIEW public.profiles_safe
WITH (security_invoker = true)
AS
  SELECT id, name, email, shift, active, last_seen_at,
         ui_preferences, created_at, updated_at
    FROM public.profiles;

GRANT SELECT ON public.profiles_safe TO authenticated;

-- Provide a SECURITY DEFINER admin-only accessor so admin pages
-- (FinancialDashboard, WorkOrderDetail) can still read labor_rate
-- without granting the column to all authenticated users.
CREATE OR REPLACE FUNCTION public.get_profile_labor_rate(_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rate numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  SELECT labor_rate INTO _rate FROM public.profiles WHERE id = _user_id;
  RETURN COALESCE(_rate, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_profile_labor_rate(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_profile_labor_rates()
RETURNS TABLE (id uuid, name text, labor_rate numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN QUERY SELECT p.id, p.name, p.labor_rate FROM public.profiles p;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_profile_labor_rates() TO authenticated;

-- ---------------------------------------------------------------------
-- 3. AUDIT LOG ENTRY
-- ---------------------------------------------------------------------
INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, details)
VALUES (
  NULL,
  'system',
  'security_hardening_pin_hash_and_labor_rate',
  'engineers,profiles',
  jsonb_build_object(
    'description',
    'Removed manager SELECT on engineers.pin_hash. Restricted profiles.labor_rate column to admins via REVOKE + SECURITY DEFINER accessor functions. Updated profiles_safe view to drop labor_rate.',
    'date', now()
  )
);
