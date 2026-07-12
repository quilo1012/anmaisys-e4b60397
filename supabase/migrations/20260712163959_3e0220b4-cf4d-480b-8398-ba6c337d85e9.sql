DROP FUNCTION IF EXISTS public.list_dm_admins();
CREATE FUNCTION public.list_dm_admins()
RETURNS TABLE(id uuid, full_name text, role app_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name AS full_name, ur.role
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role IN ('manager','maintenance_manager')
    AND COALESCE(p.active, true) = true
  ORDER BY p.name;
$$;
GRANT EXECUTE ON FUNCTION public.list_dm_admins() TO authenticated;