-- Where the headcount board puts people, which is not the same list as `lines`.
--
-- `lines` is the factory's ten production lines, and it is shared: it drives work
-- orders, downtime and maintenance reporting. The headcount sheet also groups people
-- into Office, Hygiene, Quality, WH Team, Lab and the rest. Adding those to `lines`
-- would make "Office" offerable as the location of a machine breakdown.
--
-- So the board gets its own list. The ten production areas point back at their line,
-- so the two never drift apart and a report can still join them; the support areas
-- have no line because they are not one.
CREATE TABLE IF NOT EXISTS public.headcount_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  /* 'production' areas mirror a row in lines; 'support' areas stand alone. */
  kind text NOT NULL CHECK (kind IN ('production', 'support')),
  line_id uuid REFERENCES public.lines(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.headcount_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS headcount_areas_read ON public.headcount_areas;
CREATE POLICY headcount_areas_read ON public.headcount_areas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS headcount_areas_write ON public.headcount_areas;
CREATE POLICY headcount_areas_write ON public.headcount_areas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- The ten production lines, kept in step with `lines` rather than retyped.
INSERT INTO public.headcount_areas (name, kind, line_id, sort_order)
SELECT l.name, 'production', l.id, 10
FROM public.lines l
ON CONFLICT (name) DO NOTHING;

-- The sectors the spreadsheet has and the line list never did. "Gel Room" is not
-- "GEL Line": one is where people are, the other is a production line, and the sheet
-- uses both.
INSERT INTO public.headcount_areas (name, kind, sort_order) VALUES
  ('Gel Room',     'support', 20),
  ('WH Team',      'support', 30),
  ('Hygiene',      'support', 40),
  ('Quality',      'support', 50),
  ('Lab',          'support', 60),
  ('Blender Team', 'support', 70),
  ('Assembly',     'support', 80),
  ('Runner',       'support', 90),
  ('Maintenance',  'support', 95),
  ('Office',       'support', 99)
ON CONFLICT (name) DO NOTHING;

-- Where a person stands on the board. Separate from current_line_id, which stays for
-- whatever already reads it; the board writes this one.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS headcount_area_id uuid
  REFERENCES public.headcount_areas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS employees_headcount_area_idx
  ON public.employees (headcount_area_id) WHERE active;
