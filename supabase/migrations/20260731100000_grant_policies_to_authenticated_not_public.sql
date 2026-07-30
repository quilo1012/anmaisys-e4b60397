-- Say "authenticated" where we mean authenticated.
--
-- A policy created without a TO clause is granted to the `public` role, which in
-- Postgres means every role — including `anon`, the role a signed-out browser holds
-- against the API. None of the policies below are actually exploitable by a signed-out
-- caller: each one's USING clause calls has_role(auth.uid(), …) or tests
-- auth.uid() IS NOT NULL, and for anon auth.uid() is NULL, so the check fails. But a
-- reader auditing this database has to open every policy body to establish that, and
-- one policy added later with a weaker predicate would be open to the world with
-- nothing in the grant to say so.
--
-- So the grant is narrowed to match the intent. No predicate changes; no access
-- changes for anyone who has access today.

-- Role-visibility config: which menu entries a role hides on mobile.
DROP POLICY IF EXISTS "role_mobile_hidden read" ON public.role_mobile_hidden;
CREATE POLICY "role_mobile_hidden read" ON public.role_mobile_hidden
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "role_mobile_hidden admin write" ON public.role_mobile_hidden;
CREATE POLICY "role_mobile_hidden admin write" ON public.role_mobile_hidden
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "admin manage signup_config" ON public.signup_config;
CREATE POLICY "admin manage signup_config" ON public.signup_config
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Quality roles read action history" ON public.quality_action_history;
CREATE POLICY "Quality roles read action history" ON public.quality_action_history
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'quality_supervisor'::app_role)
    OR has_role(auth.uid(), 'engineer'::app_role)
    OR has_role(auth.uid(), 'co_engineer'::app_role)
  );

DROP POLICY IF EXISTS "Maintenance managers can update WOs" ON public.work_orders;
CREATE POLICY "Maintenance managers can update WOs" ON public.work_orders
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'maintenance_manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'maintenance_manager'::app_role));

-- The banner is the hero carousel scraped from appliednutrition.uk — marketing
-- artwork that is already public on the internet, so nothing here was disclosed.
-- It is read on the welcome screen, which is behind the login, so the anonymous
-- grant buys nothing and the table is no longer readable signed-out.
DROP POLICY IF EXISTS "site_banner read" ON public.site_banner;
CREATE POLICY "site_banner read" ON public.site_banner
  FOR SELECT TO authenticated USING (true);

-- quality-photos is a private bucket holding photographs of deviations: product,
-- line and paperwork. Its three policies were granted to public with the role check
-- in the body. Same narrowing.
DROP POLICY IF EXISTS "Quality roles view quality-photos" ON storage.objects;
CREATE POLICY "Quality roles view quality-photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'quality-photos'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'manager'::app_role)
      OR has_role(auth.uid(), 'supervisor'::app_role)
      OR has_role(auth.uid(), 'quality_supervisor'::app_role)
      OR has_role(auth.uid(), 'engineer'::app_role)
      OR has_role(auth.uid(), 'co_engineer'::app_role)
    )
  );

DROP POLICY IF EXISTS "Quality managers upload quality-photos" ON storage.objects;
CREATE POLICY "Quality managers upload quality-photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'quality-photos'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'manager'::app_role)
      OR has_role(auth.uid(), 'supervisor'::app_role)
      OR has_role(auth.uid(), 'quality_supervisor'::app_role)
    )
  );

DROP POLICY IF EXISTS "Quality managers delete quality-photos" ON storage.objects;
CREATE POLICY "Quality managers delete quality-photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'quality-photos'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'manager'::app_role)
      OR has_role(auth.uid(), 'supervisor'::app_role)
      OR has_role(auth.uid(), 'quality_supervisor'::app_role)
    )
  );

-- verify_target_pin already refuses a caller with no auth.uid(), but it was still
-- EXECUTE-able by anon — an endpoint a signed-out client can call with a guess. The
-- grant goes; the guard stays.
-- FROM PUBLIC as well as FROM anon: a function is EXECUTE-able by PUBLIC by default,
-- and anon inherits that, so revoking anon alone leaves the grant standing.
REVOKE EXECUTE ON FUNCTION public.verify_target_pin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_target_pin(text) TO authenticated;
