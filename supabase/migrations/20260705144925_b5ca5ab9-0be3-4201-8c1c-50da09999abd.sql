DROP POLICY IF EXISTS "production_items operator update own line" ON public.production_items;
CREATE POLICY "production_items operator update own line"
ON public.production_items
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'operator'::app_role)
  AND EXISTS (
    SELECT 1
    FROM public.production_sessions ps
    WHERE ps.id = production_items.session_id
      AND ps.line = ANY(public.current_user_line_names())
  )
)
WITH CHECK (
  has_role(auth.uid(), 'operator'::app_role)
  AND EXISTS (
    SELECT 1
    FROM public.production_sessions ps
    WHERE ps.id = production_items.session_id
      AND ps.line = ANY(public.current_user_line_names())
  )
);

DROP POLICY IF EXISTS "production_items operator delete own line" ON public.production_items;
CREATE POLICY "production_items operator delete own line"
ON public.production_items
FOR DELETE
TO authenticated
USING (
  has_role(auth.uid(), 'operator'::app_role)
  AND EXISTS (
    SELECT 1
    FROM public.production_sessions ps
    WHERE ps.id = production_items.session_id
      AND ps.line = ANY(public.current_user_line_names())
  )
);