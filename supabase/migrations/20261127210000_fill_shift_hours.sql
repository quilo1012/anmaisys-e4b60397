-- Factory shift hours used by Fill speed matrix and Line deviation (one row, London time).
CREATE TABLE public.fill_shift_hours (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  day_start int NOT NULL DEFAULT 6 CHECK (day_start BETWEEN 0 AND 23),
  day_end int NOT NULL DEFAULT 18 CHECK (day_end BETWEEN 1 AND 24),
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (day_start < day_end)
);
GRANT SELECT, INSERT, UPDATE ON public.fill_shift_hours TO authenticated;
GRANT ALL ON public.fill_shift_hours TO service_role;
ALTER TABLE public.fill_shift_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Shift hours read" ON public.fill_shift_hours FOR SELECT TO authenticated USING (true);
CREATE POLICY "Shift hours add" ON public.fill_shift_hours FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'));
CREATE POLICY "Shift hours change" ON public.fill_shift_hours FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'));
INSERT INTO public.fill_shift_hours (id, day_start, day_end) VALUES (1, 6, 18) ON CONFLICT (id) DO NOTHING;
