CREATE POLICY "production_sessions operator insert own line"
ON public.production_sessions
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'operator'::app_role)
  AND (line = ANY (current_user_line_names()))
);