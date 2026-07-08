CREATE POLICY "production_items operator insert own line"
ON public.production_items
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'operator'::app_role) AND EXISTS (
    SELECT 1 FROM public.production_sessions ps
    WHERE ps.id = production_items.session_id
      AND ps.line = ANY (current_user_line_names())
  )
);