-- Audit table 3.3 — resolve the MATRIX×RLS divergences by ENABLING (user's
-- decision, all 8 lines). Additive per-role policies to match the existing
-- pattern. Applied live; committed for the record.

-- pm.manage → maintenance_manager
DROP POLICY IF EXISTS "PM schedules manageable by admin/manager" ON public.pm_schedules;
CREATE POLICY "PM schedules manageable by mgmt" ON public.pm_schedules FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'maintenance_manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'maintenance_manager'::app_role));
DROP POLICY IF EXISTS "PM tasks manageable by admin/manager" ON public.pm_tasks;
CREATE POLICY "PM tasks manageable by mgmt" ON public.pm_tasks FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'maintenance_manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role) OR has_role(auth.uid(),'maintenance_manager'::app_role));

-- wo.close → supervisor, co_engineer (full UPDATE, matching engineer/manager)
CREATE POLICY "Supervisors can update WOs" ON public.work_orders FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'supervisor'::app_role)) WITH CHECK (has_role(auth.uid(),'supervisor'::app_role));
CREATE POLICY "Co-engineers can update WOs" ON public.work_orders FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'co_engineer'::app_role)) WITH CHECK (has_role(auth.uid(),'co_engineer'::app_role));

-- machines.manage → supervisor (machines + machine_location_log)
CREATE POLICY "Supervisors can manage machines" ON public.machines FOR ALL TO authenticated
  USING (has_role(auth.uid(),'supervisor'::app_role)) WITH CHECK (has_role(auth.uid(),'supervisor'::app_role));
CREATE POLICY "Supervisors can manage location logs" ON public.machine_location_log FOR ALL TO authenticated
  USING (has_role(auth.uid(),'supervisor'::app_role)) WITH CHECK (has_role(auth.uid(),'supervisor'::app_role));

-- downtime.manage → supervisor, co_engineer (downtime + downtime_events)
CREATE POLICY "Supervisors can manage downtime" ON public.downtime FOR ALL TO authenticated
  USING (has_role(auth.uid(),'supervisor'::app_role)) WITH CHECK (has_role(auth.uid(),'supervisor'::app_role));
CREATE POLICY "Co-engineers can manage downtime" ON public.downtime FOR ALL TO authenticated
  USING (has_role(auth.uid(),'co_engineer'::app_role)) WITH CHECK (has_role(auth.uid(),'co_engineer'::app_role));
CREATE POLICY "dt_insert_supervisor_coeng" ON public.downtime_events FOR INSERT TO authenticated
  WITH CHECK ((stopped_by = auth.uid()) AND (has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'co_engineer'::app_role)));
CREATE POLICY "dt_update_supervisor_coeng" ON public.downtime_events FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'co_engineer'::app_role))
  WITH CHECK (has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'co_engineer'::app_role));

-- stock write → maintenance_manager, supervisor (delete stays admin-only);
-- stock read → planner, warehouse
CREATE POLICY "Maint mgr and supervisor insert products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'supervisor'::app_role));
CREATE POLICY "Maint mgr and supervisor update products" ON public.products FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'supervisor'::app_role))
  WITH CHECK (has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'supervisor'::app_role));
CREATE POLICY "Planner and warehouse view products" ON public.products FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'planner'::app_role) OR has_role(auth.uid(),'warehouse'::app_role));

-- suppliers PO write → supervisor, maintenance_manager, planner (+ RPC guard)
DROP POLICY IF EXISTS "po_write_admin_mgr" ON public.purchase_orders;
CREATE POLICY "po_write_mgmt" ON public.purchase_orders FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'planner'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role)
     OR has_role(auth.uid(),'supervisor'::app_role) OR has_role(auth.uid(),'maintenance_manager'::app_role) OR has_role(auth.uid(),'planner'::app_role));

CREATE OR REPLACE FUNCTION public.receive_purchase_order(_po_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _status text; _n int := 0;
BEGIN
  IF _uid IS NULL OR NOT (has_role(_uid,'admin'::app_role) OR has_role(_uid,'manager'::app_role)
       OR has_role(_uid,'supervisor'::app_role) OR has_role(_uid,'maintenance_manager'::app_role) OR has_role(_uid,'planner'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT status INTO _status FROM public.purchase_orders WHERE id = _po_id FOR UPDATE;
  IF _status IS NULL THEN RAISE EXCEPTION 'Purchase order not found'; END IF;
  IF _status = 'received' THEN
    RETURN jsonb_build_object('success', true, 'already_received', true, 'products_updated', 0);
  END IF;
  UPDATE public.purchase_orders SET status = 'received', received_at = now() WHERE id = _po_id;
  WITH applied AS (
    UPDATE public.products p SET quantity = p.quantity + poi.quantity
    FROM public.purchase_order_items poi
    WHERE poi.purchase_order_id = _po_id AND poi.product_id = p.id
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM applied;
  RETURN jsonb_build_object('success', true, 'products_updated', _n);
END; $function$;

-- (packaging.view is enforced in the frontend: new MATRIX action + route/nav.
--  The PVS table RLS already grants warehouse/quality_supervisor.)
