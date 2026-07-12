CREATE OR REPLACE FUNCTION public.list_dm_admins()
 RETURNS TABLE(user_id uuid, name text, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ur.user_id,
         COALESCE(p.name, p.email, ur.role::text) AS name,
         p.email
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role IN ('admin'::app_role, 'manager'::app_role, 'maintenance_manager'::app_role)
  GROUP BY ur.user_id, p.name, p.email, ur.role
  ORDER BY name ASC;
$function$;