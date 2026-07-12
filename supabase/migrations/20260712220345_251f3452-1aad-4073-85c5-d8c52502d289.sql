
-- Allow operators to DM supervisors too
DROP POLICY IF EXISTS "dm_insert_admin_or_operator_to_admin" ON public.direct_messages;
CREATE POLICY "dm_insert_admin_or_operator_to_supervisor"
  ON public.direct_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND sender_id <> recipient_id
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'supervisor'::app_role)
      OR (
        public.has_role(auth.uid(), 'operator'::app_role)
        AND (
          public.has_role(recipient_id, 'admin'::app_role)
          OR public.has_role(recipient_id, 'supervisor'::app_role)
          OR public.has_role(recipient_id, 'manager'::app_role)
          OR public.has_role(recipient_id, 'maintenance_manager'::app_role)
        )
      )
    )
  );

-- Include supervisors in the operator's partner list
DROP FUNCTION IF EXISTS public.list_dm_admins();
CREATE FUNCTION public.list_dm_admins()
RETURNS TABLE(user_id uuid, name text, email text, line_labels text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT p.id AS user_id,
         COALESCE(NULLIF(p.name,''), p.email, 'User') AS name,
         p.email,
         NULL::text AS line_labels
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role IN ('admin','supervisor','manager','maintenance_manager')
    AND COALESCE(p.active, true) = true
  ORDER BY 2;
$$;
GRANT EXECUTE ON FUNCTION public.list_dm_admins() TO authenticated;

-- Let supervisors list operator partners as well
CREATE OR REPLACE FUNCTION public.list_dm_operators()
RETURNS TABLE(user_id uuid, name text, email text, line_labels text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin or supervisor only';
  END IF;
  RETURN QUERY
    SELECT o.user_id,
           COALESCE(p.name, o.label, o.email) AS name,
           o.email,
           o.label AS line_labels
    FROM public.operator_line_accounts o
    LEFT JOIN public.profiles p ON p.id = o.user_id
    WHERE COALESCE(o.active, true) = true
    ORDER BY name ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_dm_operators() TO authenticated;
