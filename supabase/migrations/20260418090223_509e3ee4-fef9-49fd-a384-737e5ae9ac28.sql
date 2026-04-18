
-- 1) Harden SECURITY DEFINER admin PIN functions with role checks
CREATE OR REPLACE FUNCTION public.set_admin_pin(_new_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  UPDATE public.system_settings
  SET admin_pin = extensions.crypt(_new_pin, extensions.gen_salt('bf')),
      updated_at = now()
  WHERE id = (SELECT id FROM public.system_settings LIMIT 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.verify_admin_pin(_pin text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.system_settings
    WHERE admin_pin = extensions.crypt(_pin, admin_pin)
    LIMIT 1
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_admin_pin(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.verify_admin_pin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_admin_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_pin(text) TO authenticated;

-- 2) Remove engineer-to-engineer profile visibility (PIN hash / email / labor_rate exposure)
DROP POLICY IF EXISTS "Engineers can view engineer profiles" ON public.profiles;

-- 3) Tighten wo-photos storage SELECT policy
DROP POLICY IF EXISTS "Authenticated can view WO photos" ON storage.objects;

CREATE POLICY "Authorized roles view wo-photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'wo-photos' AND (
    public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR owner = auth.uid()
  )
);

-- 4) Make wo-photos bucket private (prevents direct URL listing/access)
UPDATE storage.buckets SET public = false WHERE id = 'wo-photos';

-- 5) Prevent managers from creating/assigning the 'manager' role
DROP POLICY IF EXISTS "Managers can insert non-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "Managers can update to non-admin roles" ON public.user_roles;

CREATE POLICY "Managers can insert limited roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'manager'::app_role)
  AND role IN ('engineer'::app_role, 'operator'::app_role, 'viewer'::app_role)
);

CREATE POLICY "Managers can update to limited roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager'::app_role)
  AND role IN ('engineer'::app_role, 'operator'::app_role, 'viewer'::app_role)
)
WITH CHECK (
  role IN ('engineer'::app_role, 'operator'::app_role, 'viewer'::app_role)
);

-- 6) Realtime channel authorization
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read realtime messages" ON realtime.messages;
DROP POLICY IF EXISTS "Authenticated can write realtime messages" ON realtime.messages;

CREATE POLICY "Authenticated can read realtime messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (auth.jwt() ->> 'role') = 'authenticated'
);

CREATE POLICY "Authenticated can write realtime messages"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  (auth.jwt() ->> 'role') = 'authenticated'
);
