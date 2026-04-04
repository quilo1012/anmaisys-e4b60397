
-- 1. Fix engineers table: hide pin_hash from non-admin users
-- Drop the permissive SELECT policy that exposes pin_hash to everyone
DROP POLICY IF EXISTS "Authenticated can view active engineers" ON public.engineers;

-- Create a restrictive SELECT policy: admins see everything, others see nothing
-- Non-admins will use a view instead
CREATE POLICY "Admins can view all engineers"
ON public.engineers
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create a secure view for non-admin access (excludes pin_hash)
CREATE OR REPLACE VIEW public.engineers_safe AS
SELECT id, name, is_active, created_at
FROM public.engineers
WHERE is_active = true;

-- Grant access to the view
GRANT SELECT ON public.engineers_safe TO authenticated;

-- 2. Fix engineer_scores: prevent engineers from modifying other engineers' scores
DROP POLICY IF EXISTS "System can upsert scores" ON public.engineer_scores;

-- Admins can do everything
CREATE POLICY "Admins can manage scores"
ON public.engineer_scores
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Engineers can only view their own score (keep existing SELECT policy)
-- Engineers should NOT be able to modify scores directly - scores are managed by triggers

-- 3. Fix profiles.pin exposure: revoke column-level access
REVOKE SELECT (pin) ON public.profiles FROM authenticated;
REVOKE SELECT (pin) ON public.profiles FROM anon;
