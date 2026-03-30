
-- Phase 1: Add new columns to machines table
ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS machine_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS current_location text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_maintenance_date timestamptz;

-- Phase 2: Create machine_location_log table
CREATE TABLE public.machine_location_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  from_location text NOT NULL DEFAULT '',
  to_location text NOT NULL,
  moved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.machine_location_log ENABLE ROW LEVEL SECURITY;

-- RLS: admins full access
CREATE POLICY "Admins can manage location logs"
  ON public.machine_location_log FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- RLS: engineers can view
CREATE POLICY "Engineers can view location logs"
  ON public.machine_location_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'engineer'::app_role));

-- RLS: operators can view
CREATE POLICY "Operators can view location logs"
  ON public.machine_location_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'operator'::app_role));

-- Phase 3: Trigger to auto-update machine status based on WO changes
CREATE OR REPLACE FUNCTION public.sync_machine_status_from_wo()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _open_wo_count integer;
BEGIN
  -- Only act on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- When WO becomes open or in_progress, set machine to maintenance
  IF NEW.status IN ('open', 'in_progress') THEN
    UPDATE machines SET status = 'maintenance' WHERE name = NEW.machine;
  END IF;

  -- When WO is closed or finished, check if there are other active WOs for this machine
  IF NEW.status IN ('closed', 'finished', 'completed', 'force_closed') THEN
    SELECT COUNT(*) INTO _open_wo_count
    FROM work_orders
    WHERE machine = NEW.machine
      AND id != NEW.id
      AND status NOT IN ('closed', 'finished', 'completed', 'force_closed');

    IF _open_wo_count = 0 THEN
      UPDATE machines
      SET status = 'active',
          last_maintenance_date = now()
      WHERE name = NEW.machine;
    ELSE
      -- Still has open WOs, just update last_maintenance_date
      UPDATE machines
      SET last_maintenance_date = now()
      WHERE name = NEW.machine;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_machine_status
  AFTER UPDATE ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_machine_status_from_wo();
