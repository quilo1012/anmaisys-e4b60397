
CREATE OR REPLACE FUNCTION public.list_dm_admins()
 RETURNS TABLE(user_id uuid, name text, email text, line_labels text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT p.id AS user_id,
         COALESCE(NULLIF(p.name,''), p.email, 'User') AS name,
         p.email,
         ur.role::text AS line_labels
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role IN ('supervisor','maintenance_manager','warehouse')
    AND COALESCE(p.active, true) = true
    AND p.id <> auth.uid()
  ORDER BY 2;
$function$;

DROP POLICY IF EXISTS dm_insert_operator_to_staff ON public.direct_messages;
CREATE POLICY dm_insert_operator_to_staff ON public.direct_messages
FOR INSERT TO authenticated
WITH CHECK (
  (auth.uid() = sender_id) AND (sender_id <> recipient_id) AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR has_role(auth.uid(), 'warehouse'::app_role)
    OR (
      has_role(auth.uid(), 'operator'::app_role) AND (
        has_role(recipient_id, 'supervisor'::app_role)
        OR has_role(recipient_id, 'maintenance_manager'::app_role)
        OR has_role(recipient_id, 'warehouse'::app_role)
      )
    )
  )
);
