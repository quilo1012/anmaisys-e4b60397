-- Defense-in-depth: explicit restrictive policy denying non-admin authenticated users
-- from reading system_settings (which contains the admin_pin bcrypt hash).
-- The existing "Admins can manage" permissive policy already restricts to admins,
-- but adding a restrictive policy makes the intent unambiguous and prevents
-- accidental exposure if a future broad SELECT policy is added.
CREATE POLICY "Deny non-admin authenticated access to system_settings"
ON public.system_settings
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));