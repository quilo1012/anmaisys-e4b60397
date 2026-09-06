-- 1. Columns on the existing records table -------------------------------------
ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'pm',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS external_status text,
  ADD COLUMN IF NOT EXISTS external_priority text,
  ADD COLUMN IF NOT EXISTS external_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS assignee_name text,
  ADD COLUMN IF NOT EXISTS due_date timestamptz,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS error_type text,
  ADD COLUMN IF NOT EXISTS needs_classification boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS quality_actions_external_unique
  ON public.quality_actions (source, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quality_actions_needs_classification_idx
  ON public.quality_actions (needs_classification)
  WHERE needs_classification;

-- 2. Configurable classification rules -----------------------------------------
CREATE TABLE IF NOT EXISTS public.sc_classification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- which part of the SafetyCulture action this rule looks at
  match_field text NOT NULL DEFAULT 'label'
    CHECK (match_field IN ('label','template','site','asset','custom_field','title','description','priority')),
  -- optional custom-field key when match_field = 'custom_field'
  match_key text,
  match_value text NOT NULL,
  match_mode text NOT NULL DEFAULT 'contains'
    CHECK (match_mode IN ('equals','contains','regex')),
  -- what the rule sets on the imported record
  category text,            -- e.g. LABELS / PAPERWORK
  error_type text,          -- e.g. Missing spec
  department text,
  label text,               -- one of quality_options(kind='label')
  severity text,
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sc_classification_rules TO authenticated;
GRANT ALL ON public.sc_classification_rules TO service_role;
ALTER TABLE public.sc_classification_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sc rules readable by staff"
  ON public.sc_classification_rules FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','manager','maintenance_manager','quality_supervisor','supervisor']::app_role[])
    OR public.is_owner(auth.uid())
  );

CREATE POLICY "sc rules editable by admin"
  ON public.sc_classification_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.is_owner(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.is_owner(auth.uid()));

CREATE TRIGGER trg_sc_rules_updated BEFORE UPDATE ON public.sc_classification_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Sync state -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sc_sync_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  cursor_modified_after timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  actions_imported integer NOT NULL DEFAULT 0,
  actions_updated integer NOT NULL DEFAULT 0,
  actions_skipped integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sc_sync_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.sc_sync_state TO authenticated;
GRANT ALL ON public.sc_sync_state TO service_role;
ALTER TABLE public.sc_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sc state readable by staff"
  ON public.sc_sync_state FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','manager','maintenance_manager','quality_supervisor','supervisor']::app_role[])
    OR public.is_owner(auth.uid())
  );

CREATE TRIGGER trg_sc_state_updated BEFORE UPDATE ON public.sc_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Integration log --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sc_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL
    CHECK (event IN ('received','created','updated','skipped_duplicate','deleted',
                     'auth_error','api_error','classification_error','line_leader_error',
                     'rate_limited','timeout','sync_started','sync_finished')),
  action_id text,
  action_title text,
  message text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sc_sync_logs_created_idx ON public.sc_sync_logs (created_at DESC);

GRANT SELECT ON public.sc_sync_logs TO authenticated;
GRANT ALL ON public.sc_sync_logs TO service_role;
ALTER TABLE public.sc_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sc logs readable by staff"
  ON public.sc_sync_logs FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','manager','maintenance_manager','quality_supervisor','supervisor']::app_role[])
    OR public.is_owner(auth.uid())
  );

-- 5. Seed the initial, editable classification vocabulary --------------------------
INSERT INTO public.sc_classification_rules (match_field, match_value, match_mode, category, error_type, label, priority)
VALUES
  ('label','Missing spec','contains','LABELS','Missing spec','Label',10),
  ('label','Wrong label','contains','LABELS','Wrong label','Label',10),
  ('label','Missing label','contains','LABELS','Missing label','Label',10),
  ('label','Incorrect information','contains','LABELS','Incorrect information','Label',10),
  ('label','Damaged label','contains','LABELS','Damaged label','Label',10),
  ('label','Missing paperwork','contains','PAPERWORK','Missing paperwork','Paperwork',10),
  ('label','Wrong paperwork','contains','PAPERWORK','Wrong paperwork','Paperwork',10),
  ('label','Incomplete paperwork','contains','PAPERWORK','Incomplete paperwork','Paperwork',10),
  ('title','missing spec','contains','LABELS','Missing spec','Label',50),
  ('title','wrong label','contains','LABELS','Wrong label','Label',50),
  ('title','missing label','contains','LABELS','Missing label','Label',50),
  ('title','incorrect information','contains','LABELS','Incorrect information','Label',50),
  ('title','damaged label','contains','LABELS','Damaged label','Label',50),
  ('title','missing paperwork','contains','PAPERWORK','Missing paperwork','Paperwork',50),
  ('title','wrong paperwork','contains','PAPERWORK','Wrong paperwork','Paperwork',50),
  ('title','incomplete paperwork','contains','PAPERWORK','Incomplete paperwork','Paperwork',50),
  ('title','paperwork','contains','PAPERWORK','Other','Paperwork',90),
  ('title','label','contains','LABELS','Other','Label',95)
ON CONFLICT DO NOTHING;