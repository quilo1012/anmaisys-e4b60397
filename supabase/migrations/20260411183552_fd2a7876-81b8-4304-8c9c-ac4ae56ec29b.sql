
CREATE TABLE public.machine_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid REFERENCES public.machines(id) ON DELETE SET NULL,
  work_order_id uuid,
  problem_description text,
  action_taken text,
  part_used text,
  event_type text NOT NULL DEFAULT 'repair',
  engineer_id uuid,
  engineer_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.machine_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view machine_events"
  ON public.machine_events FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Engineers admins managers can insert machine_events"
  ON public.machine_events FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'engineer'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
  );

CREATE INDEX idx_machine_events_machine_id ON public.machine_events(machine_id);
CREATE INDEX idx_machine_events_created_at ON public.machine_events(created_at DESC);
