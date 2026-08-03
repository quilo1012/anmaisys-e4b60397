-- Helper
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = ANY(_roles)
  )
$$;

-- 1) Backup tables: enable RLS, admin only
ALTER TABLE public.daily_allocations_backup_0308 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS daily_alloc_backup_admin_only ON public.daily_allocations_backup_0308;
CREATE POLICY daily_alloc_backup_admin_only ON public.daily_allocations_backup_0308
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

ALTER TABLE public.employees_backup_dedupe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employees_backup_admin_only ON public.employees_backup_dedupe;
CREATE POLICY employees_backup_admin_only ON public.employees_backup_dedupe
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- 2) Broad SELECT policies -> role scoped
DROP POLICY IF EXISTS line_leaders_read_auth ON public.line_leaders;
CREATE POLICY line_leaders_read_ops ON public.line_leaders
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','maintenance_manager','engineer','co_engineer','operator']::app_role[]));

DROP POLICY IF EXISTS "pvs read" ON public.materials;
CREATE POLICY materials_read_ops ON public.materials
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','warehouse','operator']::app_role[]));

DROP POLICY IF EXISTS "pvs read" ON public.packaging_bom;
CREATE POLICY packaging_bom_read_ops ON public.packaging_bom
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','warehouse','operator']::app_role[]));

DROP POLICY IF EXISTS "pvs read" ON public.production_orders;
CREATE POLICY production_orders_read_ops ON public.production_orders
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','warehouse','operator']::app_role[]));

DROP POLICY IF EXISTS "production_targets read all auth" ON public.production_targets;
CREATE POLICY production_targets_read_ops ON public.production_targets
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','maintenance_manager','engineer','co_engineer','operator']::app_role[]));

DROP POLICY IF EXISTS "sku_products read all auth" ON public.sku_products;
CREATE POLICY sku_products_read_ops ON public.sku_products
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','warehouse','maintenance_manager','engineer','co_engineer','operator']::app_role[]));

-- PVS sessions / scan events
DROP POLICY IF EXISTS "pvs read" ON public.pvs_sessions;
DROP POLICY IF EXISTS "pvs sessions write" ON public.pvs_sessions;
CREATE POLICY pvs_sessions_read_ops ON public.pvs_sessions
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','warehouse','operator']::app_role[]));
CREATE POLICY pvs_sessions_write_ops ON public.pvs_sessions
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','warehouse','operator']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','warehouse','operator']::app_role[]));

DROP POLICY IF EXISTS "pvs read" ON public.scan_events;
DROP POLICY IF EXISTS "pvs scans insert" ON public.scan_events;
CREATE POLICY scan_events_read_ops ON public.scan_events
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','warehouse','operator']::app_role[]));
CREATE POLICY scan_events_insert_ops ON public.scan_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','warehouse','operator']::app_role[]));

-- Suppliers: procurement/management only
DROP POLICY IF EXISTS suppliers_select_auth ON public.suppliers;
CREATE POLICY suppliers_select_scoped ON public.suppliers
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','planner','warehouse','production_office_admin','maintenance_manager']::app_role[]));

-- WO downtime exclusions: maintenance/management
DROP POLICY IF EXISTS wo_excl_read ON public.wo_downtime_exclusions;
CREATE POLICY wo_excl_read_scoped ON public.wo_downtime_exclusions
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','maintenance_manager','engineer','co_engineer','production_office_admin']::app_role[]));

-- 3) Stop broadcasting telemetry error logs over realtime
ALTER PUBLICATION supabase_realtime DROP TABLE public.system_telemetry_logs;