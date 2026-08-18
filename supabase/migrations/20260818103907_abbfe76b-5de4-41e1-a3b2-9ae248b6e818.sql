CREATE TABLE IF NOT EXISTS public.app_owner (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

GRANT SELECT ON public.app_owner TO authenticated;
GRANT ALL ON public.app_owner TO service_role;

ALTER TABLE public.app_owner ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_owner(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_owner WHERE user_id = _uid);
$$;

DROP POLICY IF EXISTS "Authenticated can see who the owner is" ON public.app_owner;
CREATE POLICY "Authenticated can see who the owner is"
  ON public.app_owner FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Only an owner may name another owner" ON public.app_owner;
CREATE POLICY "Only an owner may name another owner"
  ON public.app_owner FOR INSERT TO authenticated
  WITH CHECK (public.is_owner(auth.uid()));

DROP POLICY IF EXISTS "Only an owner may remove an owner" ON public.app_owner;
CREATE POLICY "Only an owner may remove an owner"
  ON public.app_owner FOR DELETE TO authenticated
  USING (public.is_owner(auth.uid()));

INSERT INTO public.app_owner (user_id)
SELECT u.id
FROM auth.users u
JOIN public.user_roles ur ON ur.user_id = u.id AND ur.role = 'admin'::app_role
ORDER BY u.created_at ASC
LIMIT 1
ON CONFLICT (user_id) DO NOTHING;