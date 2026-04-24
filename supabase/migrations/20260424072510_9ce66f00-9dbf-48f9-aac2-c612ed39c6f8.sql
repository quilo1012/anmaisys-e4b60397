
-- =====================================================
-- 1. ENFORCE MUTUAL EXCLUSIVITY AT DATABASE LEVEL
-- =====================================================

-- Add UNIQUE constraint: 1 user = 1 role (drop old multi-role unique if exists)
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_unique;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_unique UNIQUE (user_id);

-- =====================================================
-- 2. REWRITE WORK_ORDERS POLICIES WITH ROLE EXCLUSION
-- =====================================================
-- Operators must NOT have engineer/admin/manager role to be scoped as operator-only.
-- Engineers/managers/admins keep their broad access.

-- Drop existing policies that may grant overlapping access
DROP POLICY IF EXISTS "Operators view own line WOs (device-scoped)" ON public.work_orders;
DROP POLICY IF EXISTS "Operators can view own line WOs" ON public.work_orders;
DROP POLICY IF EXISTS "Engineers can view WOs" ON public.work_orders;
DROP POLICY IF EXISTS "Engineers can update WOs" ON public.work_orders;
DROP POLICY IF EXISTS "Engineers can view all WOs" ON public.work_orders;

-- Engineers (pure role, NOT also operator-only) — full SELECT
CREATE POLICY "Engineers can view WOs"
ON public.work_orders
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'engineer'::app_role)
);

-- Engineers can update WOs (already had this; restate cleanly)
CREATE POLICY "Engineers can update WOs"
ON public.work_orders
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'engineer'::app_role))
WITH CHECK (has_role(auth.uid(), 'engineer'::app_role));

-- Operators: scoped to own WOs OR own line ONLY IF they don't also have higher roles
-- (the higher-role policies above already cover them; this avoids accidental overlap)
CREATE POLICY "Operators view own line WOs (device-scoped)"
ON public.work_orders
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'operator'::app_role)
  AND NOT has_role(auth.uid(), 'engineer'::app_role)
  AND NOT has_role(auth.uid(), 'manager'::app_role)
  AND NOT has_role(auth.uid(), 'admin'::app_role)
  AND (
    operator_id = auth.uid()
    OR (line_id IS NOT NULL AND line_id = ANY(current_device_line_ids()))
  )
);

-- =====================================================
-- 3. PROTECT engineers.pin_hash FROM MANAGER TAMPERING
-- =====================================================
-- Managers should NOT be able to set arbitrary pin_hash values.
-- Replace blanket UPDATE with column-restricted policies.

DROP POLICY IF EXISTS "Managers can update engineers" ON public.engineers;
DROP POLICY IF EXISTS "Managers can create engineers" ON public.engineers;

-- Managers can create engineers — but the trigger below will validate pin_hash
CREATE POLICY "Managers can create engineers"
ON public.engineers
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- Managers can update engineers — but the trigger below blocks pin_hash changes
CREATE POLICY "Managers can update engineers"
ON public.engineers
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'manager'::app_role))
WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- Trigger: block managers (non-admin) from setting/changing pin_hash directly.
-- Service role (used by edge functions) bypasses RLS and these checks.
CREATE OR REPLACE FUNCTION public.guard_engineer_pin_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only enforce when there is an authenticated user (skip for service role)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins are always allowed
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  -- INSERT: managers may insert but pin_hash must be a placeholder set by an edge function path.
  -- We reject any INSERT by non-admin authenticated users that includes a pin_hash directly,
  -- forcing PIN setup via the secured RPC (set_engineer_pin_standalone).
  IF TG_OP = 'INSERT' THEN
    IF NEW.pin_hash IS NOT NULL AND NEW.pin_hash <> '' AND NEW.pin_hash <> 'temp' THEN
      RAISE EXCEPTION 'Only admins may set pin_hash directly. Use set_engineer_pin_standalone().';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: block any change to pin_hash by non-admins
  IF TG_OP = 'UPDATE' THEN
    IF NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN
      RAISE EXCEPTION 'Only admins may modify pin_hash directly. Use set_engineer_pin_standalone().';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_engineer_pin_hash_trigger ON public.engineers;
CREATE TRIGGER guard_engineer_pin_hash_trigger
BEFORE INSERT OR UPDATE ON public.engineers
FOR EACH ROW
EXECUTE FUNCTION public.guard_engineer_pin_hash();
