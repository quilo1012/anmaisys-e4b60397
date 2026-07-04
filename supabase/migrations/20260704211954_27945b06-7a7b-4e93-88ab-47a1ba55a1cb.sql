
CREATE TABLE IF NOT EXISTS public.line_production_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_name text NOT NULL UNIQUE,
  daily_avg_units int NOT NULL,
  daily_p75_units int NOT NULL,
  daily_p90_units int NOT NULL,
  daily_max_units int NOT NULL,
  active_days int NOT NULL,
  data_period text DEFAULT 'Apr-Jun 2026',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.line_production_baselines TO authenticated;
GRANT ALL ON public.line_production_baselines TO service_role;

ALTER TABLE public.line_production_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read baselines"
  ON public.line_production_baselines FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins and managers manage baselines"
  ON public.line_production_baselines FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE TRIGGER trg_line_production_baselines_updated
  BEFORE UPDATE ON public.line_production_baselines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.line_production_baselines
  (line_name, daily_avg_units, daily_p75_units, daily_p90_units, daily_max_units, active_days)
VALUES
  ('Gel',    1213,  1563,  2070,  3389, 66),
  ('Line 1', 6972,  9708,  12561, 14626, 71),
  ('Line 2', 6822,  8186,  12295, 17267, 78),
  ('Line 3', 5962,  7302,  12690, 17389, 70),
  ('Line 4', 10875, 14393, 17960, 20665, 67),
  ('Line 5', 3194,  4773,  5609,  6757,  72),
  ('Line 6', 4168,  5252,  6601,  8052,  79),
  ('Tablet', 7818,  8446,  11236, 17599, 70)
ON CONFLICT (line_name) DO UPDATE SET
  daily_avg_units = EXCLUDED.daily_avg_units,
  daily_p75_units = EXCLUDED.daily_p75_units,
  daily_p90_units = EXCLUDED.daily_p90_units,
  daily_max_units = EXCLUDED.daily_max_units,
  active_days     = EXCLUDED.active_days,
  updated_at      = now();
