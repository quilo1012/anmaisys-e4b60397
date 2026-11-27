-- PASTE INTO: AN Maintenance (apblxaaktftinstoidvp) -> Supabase dashboard -> SQL Editor. Run once.
-- Shared Fill speed matrix corrections (line/machine + pack key -> fill time in seconds).
CREATE TABLE public.fill_speed_matrix_overrides (
  matrix_key text PRIMARY KEY,
  seconds numeric NOT NULL CHECK (seconds > 0),
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fill_speed_matrix_overrides TO authenticated;
GRANT ALL ON public.fill_speed_matrix_overrides TO service_role;
ALTER TABLE public.fill_speed_matrix_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Matrix managers read" ON public.fill_speed_matrix_overrides FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'));
CREATE POLICY "Matrix managers add" ON public.fill_speed_matrix_overrides FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'));
CREATE POLICY "Matrix managers change" ON public.fill_speed_matrix_overrides FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'));
CREATE POLICY "Matrix managers remove" ON public.fill_speed_matrix_overrides FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'));
