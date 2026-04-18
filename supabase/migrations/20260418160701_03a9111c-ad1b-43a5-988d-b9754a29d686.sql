
-- 1. Nova tabela lines
CREATE TABLE IF NOT EXISTS public.lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  has_sides boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view lines"
  ON public.lines FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage lines"
  ON public.lines FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage lines"
  ON public.lines FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- 2. Seed de linhas
INSERT INTO public.lines (name, has_sides, display_order) VALUES
  ('Line 1', false, 1),
  ('Line 2', false, 2),
  ('Line 3', false, 3),
  ('Line 4', false, 4),
  ('Line 5', true,  5),
  ('Line 6', true,  6)
ON CONFLICT (name) DO NOTHING;

-- 3. Coluna side em machines
ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS side text NOT NULL DEFAULT 'common'
    CHECK (side IN ('A','B','common'));

ALTER TABLE public.machines
  ADD COLUMN IF NOT EXISTS line_id uuid REFERENCES public.lines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_machines_line_side ON public.machines(line_id, side);

-- 4. Backfill: vincular machines.line (texto) com lines.id quando bater nome
UPDATE public.machines m
SET line_id = l.id
FROM public.lines l
WHERE m.line_id IS NULL
  AND m.line IS NOT NULL
  AND m.line = l.name;

-- 5. Trigger de validação: lado A/B só em linhas com has_sides=true
CREATE OR REPLACE FUNCTION public.validate_machine_side()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  line_has_sides boolean;
BEGIN
  IF NEW.line_id IS NULL THEN
    -- Sem linha vinculada: força common
    IF NEW.side IN ('A','B') THEN
      RAISE EXCEPTION 'Machine without a linked line cannot have side A or B';
    END IF;
    RETURN NEW;
  END IF;

  SELECT has_sides INTO line_has_sides FROM public.lines WHERE id = NEW.line_id;

  IF line_has_sides = false AND NEW.side IN ('A','B') THEN
    RAISE EXCEPTION 'Line does not support sides A/B. Enable has_sides on the line first.';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_machine_side ON public.machines;
CREATE TRIGGER trg_validate_machine_side
BEFORE INSERT OR UPDATE OF side, line_id ON public.machines
FOR EACH ROW EXECUTE FUNCTION public.validate_machine_side();

-- 6. Seed de máquinas Line 5 / Line 6 (Blender + Mixer A/B)
INSERT INTO public.machines (name, machine_type, line, line_id, side, status)
SELECT 'Blender 5A', 'Blender', 'Line 5', l.id, 'A', 'active' FROM public.lines l WHERE l.name='Line 5'
  AND NOT EXISTS (SELECT 1 FROM public.machines WHERE name='Blender 5A');
INSERT INTO public.machines (name, machine_type, line, line_id, side, status)
SELECT 'Blender 5B', 'Blender', 'Line 5', l.id, 'B', 'active' FROM public.lines l WHERE l.name='Line 5'
  AND NOT EXISTS (SELECT 1 FROM public.machines WHERE name='Blender 5B');
INSERT INTO public.machines (name, machine_type, line, line_id, side, status)
SELECT 'Mixer 5A', 'Mixer', 'Line 5', l.id, 'A', 'active' FROM public.lines l WHERE l.name='Line 5'
  AND NOT EXISTS (SELECT 1 FROM public.machines WHERE name='Mixer 5A');
INSERT INTO public.machines (name, machine_type, line, line_id, side, status)
SELECT 'Mixer 5B', 'Mixer', 'Line 5', l.id, 'B', 'active' FROM public.lines l WHERE l.name='Line 5'
  AND NOT EXISTS (SELECT 1 FROM public.machines WHERE name='Mixer 5B');

INSERT INTO public.machines (name, machine_type, line, line_id, side, status)
SELECT 'Blender 6A', 'Blender', 'Line 6', l.id, 'A', 'active' FROM public.lines l WHERE l.name='Line 6'
  AND NOT EXISTS (SELECT 1 FROM public.machines WHERE name='Blender 6A');
INSERT INTO public.machines (name, machine_type, line, line_id, side, status)
SELECT 'Blender 6B', 'Blender', 'Line 6', l.id, 'B', 'active' FROM public.lines l WHERE l.name='Line 6'
  AND NOT EXISTS (SELECT 1 FROM public.machines WHERE name='Blender 6B');
INSERT INTO public.machines (name, machine_type, line, line_id, side, status)
SELECT 'Mixer 6A', 'Mixer', 'Line 6', l.id, 'A', 'active' FROM public.lines l WHERE l.name='Line 6'
  AND NOT EXISTS (SELECT 1 FROM public.machines WHERE name='Mixer 6A');
INSERT INTO public.machines (name, machine_type, line, line_id, side, status)
SELECT 'Mixer 6B', 'Mixer', 'Line 6', l.id, 'B', 'active' FROM public.lines l WHERE l.name='Mixer 6B'
  AND NOT EXISTS (SELECT 1 FROM public.machines WHERE name='Mixer 6B');
