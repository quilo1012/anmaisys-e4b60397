
-- ============ pm_schedules ============
CREATE TABLE public.pm_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  interval_days INTEGER NOT NULL CHECK (interval_days > 0),
  last_done_at TIMESTAMPTZ,
  next_due_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  assigned_engineer_id UUID,
  priority TEXT NOT NULL DEFAULT 'medium',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pm_schedules_machine ON public.pm_schedules(machine);
CREATE INDEX idx_pm_schedules_next_due ON public.pm_schedules(next_due_at) WHERE active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pm_schedules TO authenticated;
GRANT ALL ON public.pm_schedules TO service_role;

ALTER TABLE public.pm_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PM schedules viewable by all auth"
  ON public.pm_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "PM schedules manageable by admin/manager"
  ON public.pm_schedules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role));

-- ============ pm_tasks ============
CREATE TABLE public.pm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.pm_schedules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pm_tasks_schedule ON public.pm_tasks(schedule_id, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pm_tasks TO authenticated;
GRANT ALL ON public.pm_tasks TO service_role;

ALTER TABLE public.pm_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PM tasks viewable by all auth"
  ON public.pm_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "PM tasks manageable by admin/manager"
  ON public.pm_tasks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role));

-- ============ pm_executions ============
CREATE TABLE public.pm_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.pm_schedules(id) ON DELETE CASCADE,
  done_by UUID,
  done_by_name TEXT,
  done_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT,
  checklist_state JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pm_executions_schedule ON public.pm_executions(schedule_id, done_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pm_executions TO authenticated;
GRANT ALL ON public.pm_executions TO service_role;

ALTER TABLE public.pm_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PM executions viewable by all auth"
  ON public.pm_executions FOR SELECT TO authenticated USING (true);
CREATE POLICY "PM executions insertable by all auth"
  ON public.pm_executions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "PM executions deletable by admin/manager"
  ON public.pm_executions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role));

-- ============ triggers ============
CREATE OR REPLACE FUNCTION public.pm_recompute_next_due()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.last_done_at IS NOT NULL THEN
    NEW.next_due_at := NEW.last_done_at + (NEW.interval_days || ' days')::interval;
  ELSIF NEW.next_due_at IS NULL THEN
    NEW.next_due_at := now() + (NEW.interval_days || ' days')::interval;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pm_schedules_recompute_next_due
  BEFORE INSERT OR UPDATE OF last_done_at, interval_days ON public.pm_schedules
  FOR EACH ROW EXECUTE FUNCTION public.pm_recompute_next_due();

CREATE OR REPLACE FUNCTION public.pm_apply_execution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pm_schedules
     SET last_done_at = NEW.done_at
   WHERE id = NEW.schedule_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pm_executions_apply
  AFTER INSERT ON public.pm_executions
  FOR EACH ROW EXECUTE FUNCTION public.pm_apply_execution();
