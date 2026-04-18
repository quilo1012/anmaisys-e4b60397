
-- Safe profile view: only non-sensitive columns
CREATE OR REPLACE VIEW public.profiles_safe
WITH (security_invoker = true)
AS
SELECT id, name, last_seen_at, shift, active
FROM public.profiles;

GRANT SELECT ON public.profiles_safe TO authenticated;

-- Allow any authenticated user to view non-sensitive profile info (used by engineer UI)
CREATE POLICY "Authenticated can view non-sensitive profile fields"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  -- Restrict full row access; sensitive fields like pin/email/labor_rate
  -- should be queried only by the user themself, admins, or managers
  -- (existing policies already cover those cases). This permissive policy
  -- lets engineer UI (online list, scoreboard) see id+name only when
  -- selecting via profiles_safe view.
  false
);

-- Note: the policy above is intentionally restrictive (false) on the base table;
-- engineers must use profiles_safe view which uses security_invoker but only
-- exposes safe columns. Drop it — instead just grant view access.
DROP POLICY IF EXISTS "Authenticated can view non-sensitive profile fields" ON public.profiles;
