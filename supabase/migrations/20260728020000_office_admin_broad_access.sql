-- production_office_admin scope decision: "same access as admin EXCEPT Users /
-- Audit / System". Grant the role admin-like FOR ALL access on the operational
-- tables (production, maintenance/WO, downtime, quality, RAG, SKU, materials,
-- PM, machines, suppliers/POs) via additive policies (OR'd with existing, so no
-- other role is affected), and SELECT on non-admin profiles for report names.
-- EXCLUDED (intentionally NOT granted): user_roles, audit_logs, profiles(write),
-- role_permission_overrides, role_mobile_hidden, system_settings, signup_config,
-- app_settings, shift_passwords, leader_pins, pin_attempts, devices,
-- device_lines, operator_line_accounts, operator_chat_admins, engineers,
-- direct_messages, line_chat_messages, notifications, *_webhook_logs, push_*.
-- Applied live; kept for the record.
DO $$
DECLARE t text;
  tables text[] := ARRAY[
    'work_orders','work_order_logs','wo_episodes','wo_messages','wo_pauses','wo_photos',
    'downtime','downtime_events','production_downtimes',
    'machines','machine_assignments','machine_events','machine_location_log','mobile_assets',
    'problem_descriptions','line_problem_descriptions',
    'pm_schedules','pm_tasks','pm_executions',
    'quality_actions','quality_action_types','quality_action_history','quality_capa',
    'quality_daily_stats','quality_options','quality_weekly_stats','qc_inspections',
    'production_sessions','production_items','production_targets','production_blender_entries','production_orders',
    'rag_weekly_entries','rag_weekly_comments','rag_week_exclusions',
    'sku_products','sku_line_speeds','sku_production_history','product_categories','products',
    'materials','packaging_bom','raw_material_lots','batch_dispatch','batch_material_usage',
    'suppliers','purchase_orders','purchase_order_items',
    'line_leaders','line_production_baselines','lines',
    'engineer_scores','prediction_log','checklists','checklist_responses','audits',
    'intouch_machine_map','intouch_stop_code_map','shift_report_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'office_admin all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.has_role(auth.uid(),''production_office_admin''::app_role)) WITH CHECK (public.has_role(auth.uid(),''production_office_admin''::app_role))', 'office_admin all', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "office_admin read profiles" ON public.profiles;
CREATE POLICY "office_admin read profiles" ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'production_office_admin'::app_role) AND NOT public.has_role(id,'admin'::app_role));
