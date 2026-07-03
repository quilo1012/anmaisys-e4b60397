
-- Line chat messages
CREATE TABLE public.line_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.lines(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_line_chat_messages_line_created ON public.line_chat_messages(line_id, created_at DESC);

GRANT SELECT, INSERT ON public.line_chat_messages TO authenticated;
GRANT ALL ON public.line_chat_messages TO service_role;

-- Helper: resolve current user's line id from profiles.production_line -> lines.name
CREATE OR REPLACE FUNCTION public.current_user_line_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id
  FROM public.profiles p
  JOIN public.lines l ON l.name = p.production_line
  WHERE p.id = auth.uid()
  LIMIT 1;
$$;

ALTER TABLE public.line_chat_messages ENABLE ROW LEVEL SECURITY;

-- Managers/admins/maintenance_managers can see all channels
CREATE POLICY "Staff can view all line chat"
  ON public.line_chat_messages FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'maintenance_manager')
  );

-- Operators/engineers only see their own line's channel
CREATE POLICY "Users view own line chat"
  ON public.line_chat_messages FOR SELECT
  TO authenticated
  USING (line_id = public.current_user_line_id());

-- Insert: sender must be the auth user; operators only into their own line; staff into any
CREATE POLICY "Staff can post to any line"
  ON public.line_chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'maintenance_manager')
    )
  );

CREATE POLICY "Users can post to own line"
  ON public.line_chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND line_id = public.current_user_line_id()
  );

-- Enable realtime
ALTER TABLE public.line_chat_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.line_chat_messages;
