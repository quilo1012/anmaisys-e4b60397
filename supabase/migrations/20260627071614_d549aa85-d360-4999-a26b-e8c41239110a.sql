CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','engineer','operator','manager','viewer','maintenance_manager');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wo_status AS ENUM ('open','in_progress','completed','force_closed','received','arrived','finished','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id LIMIT 1
$$;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS shift text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS labor_rate numeric DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ui_preferences jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS production_line text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS role public.app_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "Users can view own role" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS intouch_sync_enabled boolean DEFAULT false;
ALTER TABLE public.system_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lines ADD COLUMN IF NOT EXISTS has_sides boolean DEFAULT false;
ALTER TABLE public.lines ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.lines ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lines TO authenticated;
GRANT ALL ON public.lines TO service_role;
ALTER TABLE public.lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.operator_line_accounts ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.operator_line_accounts ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_line_accounts TO authenticated;
GRANT ALL ON public.operator_line_accounts TO service_role;
ALTER TABLE public.operator_line_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS fixed_line text;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS current_line text;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS line_id uuid;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS side text DEFAULT 'common';
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS category public.machine_category;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS health_score integer DEFAULT 100;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS last_maintenance_date timestamptz;
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.machines TO authenticated;
GRANT ALL ON public.machines TO service_role;
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS wo_number integer;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS requester_name text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS operator_id uuid;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS engineer_id uuid;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS engineer_name text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS locked_engineer_id uuid;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS collaborator_ids uuid[] DEFAULT '{}';
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS collaborator_names text[] DEFAULT '{}';
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS line_id uuid;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS physical_line_id uuid;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS line_at_time text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS mobile_asset_id uuid;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium';
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS signed_by_name text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS line_stopped boolean DEFAULT false;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS line_stopped_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS line_stopped_by uuid;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS line_resumed_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS line_resumed_by uuid;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS received_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS arrived_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS closed_by uuid;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS current_episode integer DEFAULT 1;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS reopen_count integer DEFAULT 0;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS intouch_machine_id text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS intouch_machine_name text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS intouch_stop_code text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS intouch_stop_reason text;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS engineer_notified_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS engineer_notified_acknowledged_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_orders TO authenticated;
GRANT ALL ON public.work_orders TO service_role;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.intouch_machine_map ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.intouch_machine_map ADD COLUMN IF NOT EXISTS intouch_machine_name text;
ALTER TABLE public.intouch_machine_map ADD COLUMN IF NOT EXISTS machine_name text;
ALTER TABLE public.intouch_machine_map ADD COLUMN IF NOT EXISTS line_id uuid;
ALTER TABLE public.intouch_machine_map ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.intouch_machine_map ADD COLUMN IF NOT EXISTS last_status integer;
ALTER TABLE public.intouch_machine_map ADD COLUMN IF NOT EXISTS last_downtime_code text;
ALTER TABLE public.intouch_machine_map ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE public.intouch_machine_map ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intouch_machine_map TO authenticated;
GRANT ALL ON public.intouch_machine_map TO service_role;
ALTER TABLE public.intouch_machine_map ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.intouch_stop_code_map ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.intouch_stop_code_map ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.intouch_stop_code_map ADD COLUMN IF NOT EXISTS stop_code text;
ALTER TABLE public.intouch_stop_code_map ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.intouch_stop_code_map ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.intouch_stop_code_map ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.intouch_stop_code_map ADD COLUMN IF NOT EXISTS requires_wo boolean DEFAULT false;
ALTER TABLE public.intouch_stop_code_map ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium';
ALTER TABLE public.intouch_stop_code_map ADD COLUMN IF NOT EXISTS default_priority text DEFAULT 'medium';
ALTER TABLE public.intouch_stop_code_map ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.intouch_stop_code_map ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE public.intouch_stop_code_map SET code = COALESCE(code, stop_code), description = COALESCE(description, label), priority = COALESCE(priority, default_priority) WHERE code IS NULL OR description IS NULL OR priority IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intouch_stop_code_map TO authenticated;
GRANT ALL ON public.intouch_stop_code_map TO service_role;
ALTER TABLE public.intouch_stop_code_map ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.pm_schedules ADD COLUMN IF NOT EXISTS machine_id uuid;
ALTER TABLE public.pm_schedules ADD COLUMN IF NOT EXISTS machine_name text;
ALTER TABLE public.pm_schedules ADD COLUMN IF NOT EXISTS interval_days integer DEFAULT 30;
ALTER TABLE public.pm_schedules ADD COLUMN IF NOT EXISTS last_done_at timestamptz;
ALTER TABLE public.pm_schedules ADD COLUMN IF NOT EXISTS next_due_at timestamptz;
ALTER TABLE public.pm_schedules ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.pm_schedules ADD COLUMN IF NOT EXISTS tasks jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.pm_schedules ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE public.pm_schedules SET machine_name = COALESCE(machine_name, machine) WHERE machine_name IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pm_schedules TO authenticated;
GRANT ALL ON public.pm_schedules TO service_role;
ALTER TABLE public.pm_schedules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.production_sessions ADD COLUMN IF NOT EXISTS leader_id uuid;
ALTER TABLE public.production_sessions ADD COLUMN IF NOT EXISTS leader_name text;
ALTER TABLE public.production_sessions ADD COLUMN IF NOT EXISTS staff_planned integer DEFAULT 0;
ALTER TABLE public.production_sessions ADD COLUMN IF NOT EXISTS staff_actual integer DEFAULT 0;
ALTER TABLE public.production_sessions ADD COLUMN IF NOT EXISTS locked boolean DEFAULT false;
ALTER TABLE public.production_sessions ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE public.production_sessions ADD COLUMN IF NOT EXISTS locked_by uuid;
ALTER TABLE public.production_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_sessions TO authenticated;
GRANT ALL ON public.production_sessions TO service_role;
ALTER TABLE public.production_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.production_items ADD COLUMN IF NOT EXISTS target_qty numeric DEFAULT 0;
ALTER TABLE public.production_items ADD COLUMN IF NOT EXISTS planned_qty numeric DEFAULT 0;
ALTER TABLE public.production_items ADD COLUMN IF NOT EXISTS actual_qty numeric DEFAULT 0;
ALTER TABLE public.production_items ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.production_items ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_items TO authenticated;
GRANT ALL ON public.production_items TO service_role;
ALTER TABLE public.production_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sku_products ADD COLUMN IF NOT EXISTS target_per_hour numeric DEFAULT 0;
ALTER TABLE public.sku_products ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.sku_products ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.sku_products ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sku_products TO authenticated;
GRANT ALL ON public.sku_products TO service_role;
ALTER TABLE public.sku_products ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.rag_weekly_entries ADD COLUMN IF NOT EXISTS plan_qty numeric DEFAULT 0;
ALTER TABLE public.rag_weekly_entries ADD COLUMN IF NOT EXISTS actual_qty numeric DEFAULT 0;
ALTER TABLE public.rag_weekly_entries ADD COLUMN IF NOT EXISTS upm_target numeric DEFAULT 0;
ALTER TABLE public.rag_weekly_entries ADD COLUMN IF NOT EXISTS upm_actual numeric DEFAULT 0;
ALTER TABLE public.rag_weekly_entries ADD COLUMN IF NOT EXISTS downtime_min numeric DEFAULT 0;
ALTER TABLE public.rag_weekly_entries ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.rag_weekly_entries ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.rag_weekly_entries ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rag_weekly_entries TO authenticated;
GRANT ALL ON public.rag_weekly_entries TO service_role;
ALTER TABLE public.rag_weekly_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.production_downtimes ADD COLUMN IF NOT EXISTS downtime_date date;
ALTER TABLE public.production_downtimes ADD COLUMN IF NOT EXISTS machine text;
ALTER TABLE public.production_downtimes ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';
ALTER TABLE public.production_downtimes ADD COLUMN IF NOT EXISTS work_order_id uuid;
ALTER TABLE public.production_downtimes ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE public.production_downtimes ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
UPDATE public.production_downtimes SET downtime_date = COALESCE(downtime_date, occurred_date) WHERE downtime_date IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_downtimes TO authenticated;
GRANT ALL ON public.production_downtimes TO service_role;
ALTER TABLE public.production_downtimes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.list_active_profile_names()
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name FROM public.profiles p WHERE COALESCE(p.active, true) = true ORDER BY p.name
$$;

CREATE OR REPLACE FUNCTION public.list_engineer_names()
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.id, e.name FROM public.engineers e WHERE e.is_active = true ORDER BY e.name
$$;

CREATE OR REPLACE FUNCTION public.list_tablet_accounts_public()
RETURNS TABLE(id uuid, label text, line_ids uuid[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.label, o.line_ids FROM public.operator_line_accounts o WHERE COALESCE(o.active, true) = true ORDER BY o.label
$$;

CREATE OR REPLACE FUNCTION public.sync_rag_actual_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _session_id uuid;
  _date date;
  _line text;
  _shift text;
  _sum numeric;
BEGIN
  _session_id := COALESCE(NEW.session_id, OLD.session_id);
  SELECT session_date, line, shift INTO _date, _line, _shift FROM public.production_sessions WHERE id = _session_id;
  IF _date IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(actual_qty), 0) INTO _sum
  FROM public.production_items pi
  JOIN public.production_sessions ps ON ps.id = pi.session_id
  WHERE ps.session_date = _date AND ps.line = _line AND ps.shift = _shift;
  UPDATE public.rag_weekly_entries SET actual_qty = _sum, updated_at = now()
  WHERE entry_date = _date AND line = _line AND shift = _shift;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.wo_total_pause_seconds(_wo_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(resumed_at, now()) - paused_at))), 0)::int FROM public.wo_pauses WHERE wo_id = _wo_id
$$;

CREATE OR REPLACE VIEW public.v_wo_downtime_total AS
SELECT work_order_id, COUNT(*)::integer AS stop_count,
       COALESCE(SUM(COALESCE(duration_minutes, (EXTRACT(epoch FROM now() - stopped_at) / 60)::integer)), 0)::integer AS total_minutes,
       bool_or(resumed_at IS NULL) AS has_open_stop
FROM public.downtime_events
GROUP BY work_order_id;
GRANT SELECT ON public.v_wo_downtime_total TO authenticated;
GRANT ALL ON public.v_wo_downtime_total TO service_role;

CREATE OR REPLACE VIEW public.v_wo_metrics AS
SELECT id, wo_number, machine, priority, status, line_stopped_at, created_at, received_at AS accepted_at,
       arrived_at, started_at, finished_at, line_resumed_at, closed_at,
       EXTRACT(epoch FROM line_resumed_at - line_stopped_at)::integer AS line_downtime_sec,
       EXTRACT(epoch FROM created_at - line_stopped_at)::integer AS reporting_delay_sec,
       EXTRACT(epoch FROM received_at - created_at)::integer AS response_time_sec,
       EXTRACT(epoch FROM started_at - received_at)::integer AS travel_time_sec,
       EXTRACT(epoch FROM finished_at - started_at)::integer - public.wo_total_pause_seconds(id) AS active_repair_sec,
       EXTRACT(epoch FROM line_resumed_at - finished_at)::integer AS restart_delay_sec,
       EXTRACT(epoch FROM closed_at - line_resumed_at)::integer AS paperwork_delay_sec,
       EXTRACT(epoch FROM closed_at - created_at)::integer AS total_cycle_sec
FROM public.work_orders;
GRANT SELECT ON public.v_wo_metrics TO authenticated;
GRANT ALL ON public.v_wo_metrics TO service_role;

CREATE OR REPLACE VIEW public.profiles_safe AS SELECT id, name, email, shift, active, last_seen_at, ui_preferences, created_at, updated_at FROM public.profiles;
GRANT SELECT ON public.profiles_safe TO authenticated;
GRANT ALL ON public.profiles_safe TO service_role;

CREATE OR REPLACE VIEW public.engineers_safe AS SELECT id, name, is_active, created_at FROM public.engineers;
GRANT SELECT ON public.engineers_safe TO authenticated;
GRANT ALL ON public.engineers_safe TO service_role;

DO $$ BEGIN CREATE POLICY "profiles authenticated read" ON public.profiles FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "lines authenticated" ON public.lines FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "machines authenticated" ON public.machines FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "work orders authenticated" ON public.work_orders FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "production sessions authenticated" ON public.production_sessions FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "production items authenticated" ON public.production_items FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "sku products authenticated" ON public.sku_products FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "rag weekly authenticated" ON public.rag_weekly_entries FOR ALL TO authenticated USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "operator accounts managers" ON public.operator_line_accounts FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')) WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_production_sessions_date_line_shift ON public.production_sessions(session_date, line, shift);
CREATE INDEX IF NOT EXISTS idx_production_items_session ON public.production_items(session_id);
CREATE INDEX IF NOT EXISTS idx_rag_weekly_date_line_shift ON public.rag_weekly_entries(entry_date, line, shift);
CREATE INDEX IF NOT EXISTS idx_work_orders_created ON public.work_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON public.work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_machine ON public.work_orders(machine);
CREATE INDEX IF NOT EXISTS idx_downtime_events_wo ON public.downtime_events(work_order_id);
CREATE INDEX IF NOT EXISTS idx_pm_schedules_machine ON public.pm_schedules(machine_id);
CREATE INDEX IF NOT EXISTS idx_intouch_machine_map_line ON public.intouch_machine_map(line_id);

DROP TRIGGER IF EXISTS trg_sync_rag_actual ON public.production_items;
CREATE TRIGGER trg_sync_rag_actual AFTER INSERT OR DELETE OR UPDATE OF actual_qty ON public.production_items FOR EACH ROW EXECUTE FUNCTION public.sync_rag_actual_from_items();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_tablet_accounts_public() TO anon;

INSERT INTO public.lines (name)
VALUES ('Line 1'), ('Line 2'), ('Line 3'), ('Line 4'), ('Line 5'), ('Line 6'), ('Line 7'), ('Capsules'), ('Gel')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.system_settings (intouch_sync_enabled)
SELECT false WHERE NOT EXISTS (SELECT 1 FROM public.system_settings);