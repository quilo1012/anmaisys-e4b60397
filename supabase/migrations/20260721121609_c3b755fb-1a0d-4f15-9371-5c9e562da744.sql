-- work_orders SELECT for maintenance_manager
CREATE POLICY "Maintenance managers can view WOs"
  ON public.work_orders FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'maintenance_manager'::app_role));

-- downtime SELECT + management for maintenance_manager
CREATE POLICY "Maintenance managers can view downtime"
  ON public.downtime FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'maintenance_manager'::app_role));

-- downtime_events: replace scoped select policy to include maintenance_manager
DROP POLICY IF EXISTS "Scoped downtime_events select" ON public.downtime_events;
CREATE POLICY "Scoped downtime_events select"
  ON public.downtime_events FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR has_role(auth.uid(), 'engineer'::app_role)
    OR (stopped_by = auth.uid())
    OR (resumed_by = auth.uid())
    OR (EXISTS (
      SELECT 1 FROM work_orders wo
      WHERE wo.id = downtime_events.work_order_id
        AND (
          wo.operator_id = auth.uid()
          OR (has_role(auth.uid(), 'operator'::app_role) AND (EXISTS (
            SELECT 1 FROM operator_line_accounts ola
            WHERE ola.user_id = auth.uid() AND wo.line_id = ANY (ola.line_ids)
          )))
        )
    ))
  );

-- parts_used SELECT for maintenance_manager
CREATE POLICY "Maintenance managers can view all parts used"
  ON public.parts_used FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'maintenance_manager'::app_role));

-- engineer_scores SELECT for maintenance_manager
CREATE POLICY "Maintenance managers can view all scores"
  ON public.engineer_scores FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'maintenance_manager'::app_role));

-- audit_logs SELECT for maintenance_manager
CREATE POLICY "Maintenance managers can view audit logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'maintenance_manager'::app_role));

-- devices SELECT for maintenance_manager
CREATE POLICY "Maintenance managers can view devices"
  ON public.devices FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'maintenance_manager'::app_role));