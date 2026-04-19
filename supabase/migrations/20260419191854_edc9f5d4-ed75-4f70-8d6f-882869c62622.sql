-- ═══════════════════════════════════════════════════════════
-- STEP 1: Add category enum + columns on machines
-- ═══════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE public.machine_category AS ENUM ('line_fixed', 'line_mobile', 'support');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS category public.machine_category,
  ADD COLUMN IF NOT EXISTS fixed_line text,
  ADD COLUMN IF NOT EXISTS current_line text;

-- Backfill: Filler/Blender Line N -> line_fixed, fixed_line='Line N' (ignore A/B suffix for line label)
UPDATE public.machines
   SET category = 'line_fixed',
       fixed_line = regexp_replace(name, '^(Filler |Blender )(Line [0-9]+)([AB])?$', '\2')
 WHERE category IS NULL
   AND name ~ '^(Filler|Blender) Line [0-9]+[AB]?$';

-- Capsules Blender 1/2 -> line_fixed, Capsules Area
UPDATE public.machines
   SET category = 'line_fixed', fixed_line = 'Capsules Area'
 WHERE category IS NULL AND name LIKE 'Capsules Blender%';

-- Capsules 1, Capsules 2 -> line_fixed, Capsules Area
UPDATE public.machines
   SET category = 'line_fixed', fixed_line = 'Capsules Area'
 WHERE category IS NULL AND name ~ '^Capsules [0-9]+$';

-- Capsules Packing -> line_fixed (per option 1 in original prompt: packing fixed)
UPDATE public.machines
   SET category = 'line_fixed', fixed_line = 'Capsules Area'
 WHERE category IS NULL AND name = 'Capsules Packing';

-- Gel Machine + Gel Packing -> line_fixed, Gel Area
UPDATE public.machines
   SET category = 'line_fixed', fixed_line = 'Gel Area'
 WHERE category IS NULL AND name LIKE 'Gel %';

-- Printers -> line_mobile, current_line defaults to existing line column if present
UPDATE public.machines
   SET category = 'line_mobile',
       current_line = NULLIF(line, '')
 WHERE category IS NULL AND name LIKE 'Printer%';

-- ═══════════════════════════════════════════════════════════
-- STEP 2: machine_assignments table + move RPC
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.machine_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  assigned_line text NOT NULL,
  assigned_from timestamptz NOT NULL DEFAULT now(),
  assigned_until timestamptz,
  moved_by uuid REFERENCES auth.users(id),
  notes text
);

CREATE INDEX IF NOT EXISTS idx_machine_assignments_active
  ON public.machine_assignments(machine_id)
  WHERE assigned_until IS NULL;

ALTER TABLE public.machine_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view machine_assignments" ON public.machine_assignments;
CREATE POLICY "Authenticated can view machine_assignments"
  ON public.machine_assignments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage machine_assignments" ON public.machine_assignments;
CREATE POLICY "Admins manage machine_assignments"
  ON public.machine_assignments FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

CREATE OR REPLACE FUNCTION public.move_machine_to_line(
  _machine_id uuid,
  _new_line text,
  _notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cat public.machine_category;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT category INTO _cat FROM public.machines WHERE id = _machine_id;
  IF _cat IS NULL THEN RAISE EXCEPTION 'Machine not found'; END IF;
  IF _cat <> 'line_mobile' THEN
    RAISE EXCEPTION 'Machine is not mobile (category=%)', _cat;
  END IF;

  IF NOT (public.has_role(_uid,'admin'::app_role) OR public.has_role(_uid,'manager'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden: only admin or manager can move mobile machines';
  END IF;

  UPDATE public.machine_assignments
     SET assigned_until = now()
   WHERE machine_id = _machine_id AND assigned_until IS NULL;

  INSERT INTO public.machine_assignments(machine_id, assigned_line, moved_by, notes)
  VALUES (_machine_id, _new_line, _uid, _notes);

  UPDATE public.machines
     SET current_line = _new_line
   WHERE id = _machine_id;

  PERFORM public.log_audit_event(
    'machine_moved', 'machine', _machine_id::text,
    jsonb_build_object('new_line', _new_line, 'notes', _notes)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.move_machine_to_line(uuid, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════
-- STEP 5: line_at_time snapshot via BEFORE INSERT trigger
-- (work_orders.machine is text, so lookup by name)
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS line_at_time text;

CREATE OR REPLACE FUNCTION public.work_orders_set_line_at_time()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.line_at_time IS NULL AND NEW.machine IS NOT NULL THEN
    SELECT
      CASE m.category
        WHEN 'line_fixed'  THEN m.fixed_line
        WHEN 'line_mobile' THEN COALESCE(m.current_line, NULLIF(m.line, ''))
        ELSE NULLIF(m.line, '')
      END
      INTO NEW.line_at_time
    FROM public.machines m
    WHERE m.name = NEW.machine
    LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_work_orders_set_line_at_time ON public.work_orders;
CREATE TRIGGER trg_work_orders_set_line_at_time
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.work_orders_set_line_at_time();