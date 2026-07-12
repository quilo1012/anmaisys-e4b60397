CREATE TABLE public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  sender_name text NOT NULL,
  recipient_id uuid NOT NULL,
  message text NOT NULL DEFAULT '',
  image_url text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_direct_messages_pair ON public.direct_messages (
  LEAST(sender_id, recipient_id),
  GREATEST(sender_id, recipient_id),
  created_at DESC
);
CREATE INDEX idx_direct_messages_recipient_unread ON public.direct_messages (recipient_id) WHERE read_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON public.direct_messages TO authenticated;
GRANT ALL ON public.direct_messages TO service_role;

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

-- Read: sender or recipient
CREATE POLICY "dm_select_own"
  ON public.direct_messages FOR SELECT
  TO authenticated
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- Insert: sender must be self; admin can DM anyone, operator can only DM an admin
CREATE POLICY "dm_insert_admin_or_operator_to_admin"
  ON public.direct_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND sender_id <> recipient_id
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR (
        public.has_role(auth.uid(), 'operator'::app_role)
        AND public.has_role(recipient_id, 'admin'::app_role)
      )
    )
  );

-- Update: only recipient can mark as read (limited to read_at)
CREATE POLICY "dm_update_mark_read"
  ON public.direct_messages FOR UPDATE
  TO authenticated
  USING (auth.uid() = recipient_id)
  WITH CHECK (auth.uid() = recipient_id);

-- Realtime
ALTER TABLE public.direct_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages;

-- Helper: list operator conversation partners for admin sidebar
CREATE OR REPLACE FUNCTION public.list_dm_operators()
RETURNS TABLE(user_id uuid, name text, email text, line_labels text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin only';
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

-- Helper: for operators, return the list of admin recipients
CREATE OR REPLACE FUNCTION public.list_dm_admins()
RETURNS TABLE(user_id uuid, name text, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.user_id,
         COALESCE(p.name, p.email, 'Admin') AS name,
         p.email
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role = 'admin'::app_role
  ORDER BY name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.list_dm_operators() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_dm_admins() TO authenticated;