
-- Production sessions: add planner fields
ALTER TABLE public.production_sessions
  ADD COLUMN IF NOT EXISTS leader_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS leader_name text,
  ADD COLUMN IF NOT EXISTS staff_planned integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS staff_actual integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid REFERENCES auth.users(id);

-- Production items: ensure target/actual split (already has planned_qty/actual_qty; alias not needed)
ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS target_qty numeric;

-- Quality actions: add fields used in UI
ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS shift text,
  ADD COLUMN IF NOT EXISTS leader_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS leader_name text,
  ADD COLUMN IF NOT EXISTS points integer DEFAULT 1;

-- Quality action types: add points
ALTER TABLE public.quality_action_types
  ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 1;

-- Unique (session_date, line, shift) on production_sessions for upsert
CREATE UNIQUE INDEX IF NOT EXISTS production_sessions_date_line_shift_uidx
  ON public.production_sessions (session_date, line, shift);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS production_items_session_idx ON public.production_items (session_id);
CREATE INDEX IF NOT EXISTS quality_actions_recorded_at_idx ON public.quality_actions (recorded_at DESC);
CREATE INDEX IF NOT EXISTS sku_products_active_idx ON public.sku_products (active) WHERE active = true;
