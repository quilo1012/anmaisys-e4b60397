
-- 1) login_branding: restrict SELECT to authenticated only; expose public read via SECURITY DEFINER RPC
DROP POLICY IF EXISTS "Anyone can read login branding" ON public.login_branding;

CREATE POLICY "Authenticated can read login branding"
  ON public.login_branding FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.get_login_branding()
RETURNS TABLE (mode text, url text, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mode, url, updated_at FROM public.login_branding;
$$;

REVOKE EXECUTE ON FUNCTION public.get_login_branding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_login_branding() TO anon, authenticated;

-- 2) profiles.labor_rate: re-assert column-level revoke (defense in depth) and tighten manager policy
--    Manager SELECT policy retained but labor_rate column is inaccessible via column privileges.
REVOKE SELECT (labor_rate), UPDATE (labor_rate) ON public.profiles FROM anon, authenticated, PUBLIC;

-- Explicitly recreate manager SELECT policy with a comment documenting labor_rate exclusion
DROP POLICY IF EXISTS "Managers can view non-admin profiles" ON public.profiles;
CREATE POLICY "Managers can view non-admin profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'manager'::app_role)
    AND NOT has_role(id, 'admin'::app_role)
  );
COMMENT ON POLICY "Managers can view non-admin profiles" ON public.profiles IS
  'Row-level access for managers. Column-level GRANTs REVOKE labor_rate from authenticated so managers cannot read it; only admins access labor_rate via list_profile_labor_rates / get_profile_labor_rate SECURITY DEFINER RPCs.';

-- 3) storage.objects wo-photos: verify ownership against public.wo_photos.uploaded_by
DROP POLICY IF EXISTS "Uploaders and admins can update wo-photos" ON storage.objects;
DROP POLICY IF EXISTS "Uploaders can delete own photos" ON storage.objects;

CREATE POLICY "Uploaders and admins can update wo-photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'wo-photos'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'manager'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.wo_photos p
        WHERE p.storage_path = storage.objects.name
          AND p.uploaded_by = auth.uid()
      )
    )
  )
  WITH CHECK (
    bucket_id = 'wo-photos'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'manager'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.wo_photos p
        WHERE p.storage_path = storage.objects.name
          AND p.uploaded_by = auth.uid()
      )
    )
  );

CREATE POLICY "Uploaders can delete own wo-photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'wo-photos'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1 FROM public.wo_photos p
        WHERE p.storage_path = storage.objects.name
          AND p.uploaded_by = auth.uid()
      )
    )
  );
