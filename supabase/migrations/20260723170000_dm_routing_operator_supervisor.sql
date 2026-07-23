-- Direct-message routing rules:
--   operator                                   → supervisor, or the designated admin (Daniel)
--   supervisor                                 → operators + management (the bridge)
--   daniel.quilo@appliednutrition.uk (admin)   → anyone, including operators
--   other admin/manager/maint/warehouse        → management + supervisors, NEVER operators

-- Only this specific admin may chat with operators.
CREATE OR REPLACE FUNCTION public.is_operator_chat_admin(uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND lower(email) = 'daniel.quilo@appliednutrition.uk'
  );
$function$;
GRANT EXECUTE ON FUNCTION public.is_operator_chat_admin(uuid) TO authenticated;

-- Unified partner list, scoped by the caller's role.
CREATE OR REPLACE FUNCTION public.list_dm_partners()
RETURNS TABLE(user_id uuid, name text, email text, line_labels text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;

  IF public.has_role(auth.uid(), 'operator'::app_role) THEN
    RETURN QUERY
      SELECT DISTINCT p.id, COALESCE(NULLIF(p.name,''), p.email, 'User'), p.email,
             CASE WHEN ur.role = 'supervisor' THEN 'Supervisor' ELSE 'Admin' END
      FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE COALESCE(p.active, true) = true AND p.id <> auth.uid()
        AND (ur.role = 'supervisor' OR public.is_operator_chat_admin(p.id))
      ORDER BY 2;

  ELSIF public.has_role(auth.uid(), 'supervisor'::app_role) THEN
    RETURN QUERY
      SELECT o.user_id, COALESCE(p.name, o.label, o.email), o.email, o.label
      FROM public.operator_line_accounts o LEFT JOIN public.profiles p ON p.id = o.user_id
      WHERE COALESCE(o.active, true) = true
      UNION
      SELECT DISTINCT p.id, COALESCE(NULLIF(p.name,''), p.email, 'User'), p.email, initcap(ur.role::text)
      FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE ur.role IN ('admin','manager','maintenance_manager','warehouse','supervisor')
        AND COALESCE(p.active, true) = true AND p.id <> auth.uid();

  ELSIF public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role)
     OR public.has_role(auth.uid(),'maintenance_manager'::app_role) OR public.has_role(auth.uid(),'warehouse'::app_role) THEN
    RETURN QUERY
      SELECT DISTINCT p.id, COALESCE(NULLIF(p.name,''), p.email, 'User'), p.email, initcap(ur.role::text)
      FROM public.profiles p JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE ur.role IN ('admin','manager','maintenance_manager','warehouse','supervisor')
        AND COALESCE(p.active, true) = true AND p.id <> auth.uid()
      UNION
      SELECT o.user_id, COALESCE(p.name, o.label, o.email), o.email, o.label
      FROM public.operator_line_accounts o LEFT JOIN public.profiles p ON p.id = o.user_id
      WHERE public.is_operator_chat_admin(auth.uid()) AND COALESCE(o.active, true) = true;
  ELSE
    RAISE EXCEPTION 'Forbidden';
  END IF;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.list_dm_partners() TO authenticated;

-- Enforce the routing on INSERT (backend validation).
DROP POLICY IF EXISTS "dm_insert_operator_to_staff" ON public.direct_messages;
DROP POLICY IF EXISTS "dm_insert_routing" ON public.direct_messages;
CREATE POLICY "dm_insert_routing"
  ON public.direct_messages
  FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND sender_id <> recipient_id
    AND (
      (public.has_role(sender_id, 'operator'::app_role)
        AND (public.has_role(recipient_id, 'supervisor'::app_role) OR public.is_operator_chat_admin(recipient_id)))
      OR public.has_role(sender_id, 'supervisor'::app_role)
      OR public.is_operator_chat_admin(sender_id)
      OR (
        (public.has_role(sender_id, 'admin'::app_role) OR public.has_role(sender_id, 'manager'::app_role)
          OR public.has_role(sender_id, 'maintenance_manager'::app_role) OR public.has_role(sender_id, 'warehouse'::app_role))
        AND NOT public.has_role(recipient_id, 'operator'::app_role)
      )
    )
  );
