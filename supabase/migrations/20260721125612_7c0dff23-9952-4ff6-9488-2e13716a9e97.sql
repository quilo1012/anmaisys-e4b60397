
-- Expand operator DM partners: allow chatting with admin, supervisor, manager, maintenance_manager, warehouse
CREATE OR REPLACE FUNCTION public.list_dm_admins()
RETURNS TABLE(user_id uuid, name text, email text, line_labels text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT p.id AS user_id,
         COALESCE(NULLIF(p.name,''), p.email, 'User') AS name,
         p.email,
         ur.role::text AS line_labels
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role IN ('admin','supervisor','manager','maintenance_manager','warehouse')
    AND COALESCE(p.active, true) = true
    AND p.id <> auth.uid()
  ORDER BY 2;
$$;
GRANT EXECUTE ON FUNCTION public.list_dm_admins() TO authenticated;

-- Update RLS insert policy: operators can DM admin/supervisor/manager/maintenance_manager/warehouse
DROP POLICY IF EXISTS "dm_insert_operator_to_supervisor_manager" ON public.direct_messages;
CREATE POLICY "dm_insert_operator_to_staff"
  ON public.direct_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND sender_id <> recipient_id
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'supervisor'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
      OR public.has_role(auth.uid(), 'warehouse'::app_role)
      OR (
        public.has_role(auth.uid(), 'operator'::app_role)
        AND (
          public.has_role(recipient_id, 'admin'::app_role)
          OR public.has_role(recipient_id, 'supervisor'::app_role)
          OR public.has_role(recipient_id, 'manager'::app_role)
          OR public.has_role(recipient_id, 'maintenance_manager'::app_role)
          OR public.has_role(recipient_id, 'warehouse'::app_role)
        )
      )
    )
  );

-- Allow maintenance_manager and warehouse to list operator partners too
CREATE OR REPLACE FUNCTION public.list_dm_operators()
RETURNS TABLE(user_id uuid, name text, email text, line_labels text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden';
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
