-- 1) Tighten always-true RLS policies on production_sessions/items + quality_actions
-- Restrict INSERT/UPDATE to admin or manager (read remains open to authenticated users).

DROP POLICY IF EXISTS "production_sessions insert auth" ON public.production_sessions;
DROP POLICY IF EXISTS "production_sessions update auth" ON public.production_sessions;
CREATE POLICY "production_sessions insert admin/manager"
  ON public.production_sessions FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));
CREATE POLICY "production_sessions update admin/manager"
  ON public.production_sessions FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

DROP POLICY IF EXISTS "production_items insert auth" ON public.production_items;
DROP POLICY IF EXISTS "production_items update auth" ON public.production_items;
CREATE POLICY "production_items insert admin/manager"
  ON public.production_items FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));
CREATE POLICY "production_items update admin/manager"
  ON public.production_items FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

DROP POLICY IF EXISTS "quality_actions insert auth" ON public.quality_actions;
DROP POLICY IF EXISTS "quality_actions update auth" ON public.quality_actions;
CREATE POLICY "quality_actions insert admin/manager"
  ON public.quality_actions FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));
CREATE POLICY "quality_actions update admin/manager"
  ON public.quality_actions FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'manager'::app_role));

-- The service-role INSERT policy is redundant (service_role bypasses RLS) and trips the linter.
DROP POLICY IF EXISTS "Service role inserts logs" ON public.intouch_webhook_logs;

-- 2) Revoke EXECUTE on SECURITY DEFINER trigger/helper functions that should never be
-- called directly via the Data API. Triggers still run because they fire as the table
-- owner regardless of EXECUTE grants.
DO $$
DECLARE
  fn text;
  trigger_fns text[] := ARRAY[
    'validate_stock_availability()',
    'work_orders_set_line_at_time()',
    'work_orders_set_line_at_time_v2()',
    'update_updated_at_column()',
    'set_updated_at()',
    'guard_engineer_pin_hash()',
    'handle_new_user()',
    'validate_downtime_category()',
    'reduce_stock_on_parts_used()',
    'sync_wo_line_status()',
    'sync_machine_status_from_wo()',
    'recalculate_health_scores()',
    'update_engineer_score()',
    'pm_recompute_next_due()',
    'pm_apply_execution()',
    'validate_machine_side()'
  ];
BEGIN
  FOREACH fn IN ARRAY trigger_fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END $$;

-- 3) Revoke anon EXECUTE on remaining SECURITY DEFINER functions exposed in public.
-- Anonymous users have no business calling any of these RPCs; the app calls them as
-- authenticated users only.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, PUBLIC', r.sig);
  END LOOP;
END $$;

-- Re-grant EXECUTE to authenticated on RPCs the app calls from the client.
GRANT EXECUTE ON FUNCTION
  public.verify_pin_by_code(text),
  public.get_profile_labor_rate(uuid),
  public.pair_device_lines(text, uuid[], text),
  public.unpair_device(uuid),
  public.list_profile_labor_rates(),
  public.verify_engineer_pin(uuid, text),
  public.set_engineer_pin_standalone(uuid, text),
  public.reopen_wo_recurrence(uuid, text),
  public.get_device_line(text),
  public.has_role(uuid, app_role),
  public.add_wo_collaborator(uuid, text),
  public.set_engineer_pin(uuid, text),
  public.current_user_role(),
  public.log_wo_retrigger(uuid, text),
  public.move_machine_to_line(uuid, text, text),
  public.get_user_role(uuid),
  public.reopen_wo_as_recurrence(uuid, text),
  public.accept_wo_with_pin(uuid, text),
  public.verify_admin_pin(text),
  public.pair_device(text, uuid, text),
  public.current_device_line_ids(),
  public.set_admin_pin(text),
  public.verify_pin_with_lockout(text),
  public.log_audit_event(text, text, text, jsonb),
  public.list_operator_account_user_ids(),
  public.get_own_labor_rate(),
  public.list_engineer_names(),
  public.current_device_line(),
  public.current_device_token(),
  public.acknowledge_wo_alert(uuid),
  public.finish_wo_with_pin(uuid, text, text),
  public.import_sku_products(jsonb),
  public.list_active_profile_names(),
  public.admin_list_device_tokens(),
  public.touch_device(text),
  public.list_tablet_accounts_public()
TO authenticated;
