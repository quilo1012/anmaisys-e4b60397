-- SafetyCulture-style fields for quality actions:
--  action_no   – manual reference number (e.g. the SafetyCulture "AC-6114")
--  status      – workflow state (To do / In progress / Complete)
--  labels      – multiple tags (CCP, Foreign Body, GMP, ...)
--  department  – responsible team (Supervisor / Quality / Warehouse)
ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS action_no  text,
  ADD COLUMN IF NOT EXISTS status     text NOT NULL DEFAULT 'todo',
  ADD COLUMN IF NOT EXISTS labels     text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS department text;

ALTER TABLE public.quality_actions DROP CONSTRAINT IF EXISTS quality_actions_status_chk;
ALTER TABLE public.quality_actions
  ADD CONSTRAINT quality_actions_status_chk
  CHECK (status IN ('todo', 'in_progress', 'complete'));

CREATE INDEX IF NOT EXISTS idx_quality_actions_status ON public.quality_actions (status);
CREATE INDEX IF NOT EXISTS idx_quality_actions_department ON public.quality_actions (department);
CREATE INDEX IF NOT EXISTS idx_quality_actions_action_no ON public.quality_actions (action_no);
