
DROP POLICY IF EXISTS "Authenticated can view checklist_responses" ON public.checklist_responses;
CREATE POLICY "checklist_responses scoped read"
ON public.checklist_responses FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::app_role)
  OR public.has_role(auth.uid(),'manager'::app_role)
  OR public.has_role(auth.uid(),'maintenance_manager'::app_role)
  OR public.has_role(auth.uid(),'supervisor'::app_role)
  OR public.has_role(auth.uid(),'planner'::app_role)
  OR public.has_role(auth.uid(),'engineer'::app_role)
  OR public.has_role(auth.uid(),'co_engineer'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.work_orders wo
    LEFT JOIN public.lines l ON l.id = wo.line_id
    WHERE wo.id = checklist_responses.work_order_id
      AND (wo.operator_id = auth.uid()
           OR (l.name IS NOT NULL AND l.name = ANY(public.current_user_line_names())))
  )
);

DROP POLICY IF EXISTS "production_sessions read all auth" ON public.production_sessions;
CREATE POLICY "production_sessions scoped read"
ON public.production_sessions FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::app_role)
  OR public.has_role(auth.uid(),'manager'::app_role)
  OR public.has_role(auth.uid(),'maintenance_manager'::app_role)
  OR public.has_role(auth.uid(),'supervisor'::app_role)
  OR public.has_role(auth.uid(),'planner'::app_role)
  OR public.has_role(auth.uid(),'engineer'::app_role)
  OR public.has_role(auth.uid(),'co_engineer'::app_role)
  OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
  OR public.has_role(auth.uid(),'warehouse'::app_role)
  OR (line = ANY(public.current_user_line_names()))
);

DROP POLICY IF EXISTS "Authenticated can view sku history" ON public.sku_production_history;
CREATE POLICY "sku_production_history scoped read"
ON public.sku_production_history FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin'::app_role)
  OR public.has_role(auth.uid(),'manager'::app_role)
  OR public.has_role(auth.uid(),'maintenance_manager'::app_role)
  OR public.has_role(auth.uid(),'supervisor'::app_role)
  OR public.has_role(auth.uid(),'planner'::app_role)
  OR public.has_role(auth.uid(),'engineer'::app_role)
  OR public.has_role(auth.uid(),'co_engineer'::app_role)
  OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.lines l
    WHERE l.id = sku_production_history.line_id
      AND l.name = ANY(public.current_user_line_names())
  )
);

REVOKE SELECT (labor_rate) ON public.profiles FROM authenticated;
REVOKE SELECT (labor_rate) ON public.profiles FROM anon;
GRANT SELECT (id, name, email, active, shift, created_at, updated_at, last_seen_at, ui_preferences, production_line)
  ON public.profiles TO authenticated;
