
DROP VIEW IF EXISTS public.profiles_safe;

CREATE VIEW public.profiles_safe
WITH (security_invoker = true) AS
SELECT id, name, shift, active, last_seen_at
FROM public.profiles;

GRANT SELECT ON public.profiles_safe TO authenticated;
