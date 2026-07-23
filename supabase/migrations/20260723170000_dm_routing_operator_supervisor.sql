-- Direct-message routing rules:
--   operator                                   → supervisor ONLY
--   supervisor                                 → operators + management (the bridge)
--   admin / manager / maintenance_manager /
--   warehouse (management)                     → management + supervisors, NEVER operators
--
-- Fixes the bug where an admin could message an operator who never saw it
-- (operators only ever list supervisors as partners).

-- 1) Unified partner list, scoped by the caller's role.
CREATE OR REPLACE FUNCTION public.list_dm_partners()
RETURNS TABLE(user_id uuid, name text, email text, line_labels text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Operators talk to supervisors only.
  IF public.has_role(auth.uid(), 'operator'::app_role) THEN
    RETURN QUERY
      SELECT DISTINCT p.id,
             COALESCE(NULLIF(p.name,''), p.email, 'User'),
             p.email,
             'Supervisor'::text
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE ur.role = 'supervisor'
        AND COALESCE(p.active, true) = true
        AND p.id <> auth.uid()
      ORDER BY 2;

  -- Supervisors are the bridge: operators + management.
  ELSIF public.has_role(auth.uid(), 'supervisor'::app_role) THEN
    RETURN QUERY
      SELECT o.user_id,
             COALESCE(p.name, o.label, o.email),
             o.email,
             o.label
      FROM public.operator_line_accounts o
      LEFT JOIN public.profiles p ON p.id = o.user_id
      WHERE COALESCE(o.active, true) = true
      UNION
      SELECT DISTINCT p.id,
             COALESCE(NULLIF(p.name,''), p.email, 'User'),
             p.email,
             initcap(ur.role::text)
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE ur.role IN ('admin','manager','maintenance_manager','warehouse','supervisor')
        AND COALESCE(p.active, true) = true
        AND p.id <> auth.uid();

  -- Management talk to each other + supervisors (never operators).
  ELSIF public.has_role(auth.uid(),'admin'::app_role)
     OR public.has_role(auth.uid(),'manager'::app_role)
     OR public.has_role(auth.uid(),'maintenance_manager'::app_role)
     OR public.has_role(auth.uid(),'warehouse'::app_role) THEN
    RETURN QUERY
      SELECT DISTINCT p.id,
             COALESCE(NULLIF(p.name,''), p.email, 'User'),
             p.email,
             initcap(ur.role::text)
      FROM public.profiles p
      JOIN public.user_roles ur ON ur.user_id = p.id
      WHERE ur.role IN ('admin','manager','maintenance_manager','warehouse','supervisor')
        AND COALESCE(p.active, true) = true
        AND p.id <> auth.uid();
  ELSE
    RAISE EXCEPTION 'Forbidden';
  END IF;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_dm_partners() TO authenticated;

-- 2) Enforce the same routing on INSERT (backend validation).
DROP POLICY IF EXISTS "dm_insert_operator_to_staff" ON public.direct_messages;
CREATE POLICY "dm_insert_routing"
  ON public.direct_messages
  FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND sender_id <> recipient_id
    AND (
      -- operator → supervisor only
      (public.has_role(sender_id, 'operator'::app_role) AND public.has_role(recipient_id, 'supervisor'::app_role))
      OR
      -- supervisor → anyone (bridge to operators and management)
      public.has_role(sender_id, 'supervisor'::app_role)
      OR
      -- management → management + supervisors, never operators
      (
        (public.has_role(sender_id, 'admin'::app_role)
          OR public.has_role(sender_id, 'manager'::app_role)
          OR public.has_role(sender_id, 'maintenance_manager'::app_role)
          OR public.has_role(sender_id, 'warehouse'::app_role))
        AND NOT public.has_role(recipient_id, 'operator'::app_role)
      )
    )
  );
