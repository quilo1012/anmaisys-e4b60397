CREATE OR REPLACE FUNCTION public.list_dm_admins()
RETURNS TABLE(user_id uuid, name text, email text, line_labels text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT p.id AS user_id,
         COALESCE(NULLIF(p.name,''), p.email, 'User') AS name,
         p.email,
         NULL::text AS line_labels
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role = 'supervisor'
    AND COALESCE(p.active, true) = true
  ORDER BY 2;
$$;
GRANT EXECUTE ON FUNCTION public.list_dm_admins() TO authenticated;