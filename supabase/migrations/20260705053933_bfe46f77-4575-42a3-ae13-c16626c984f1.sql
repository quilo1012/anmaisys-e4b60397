CREATE TABLE IF NOT EXISTS public.sku_line_speeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_code text NOT NULL,
  sku_name text,
  line_name text NOT NULL,
  shift text NOT NULL DEFAULT 'DAY',
  avg_units_per_hour numeric NOT NULL,
  max_units_per_hour numeric,
  min_units_per_hour numeric,
  total_sessions int DEFAULT 0,
  total_qty_produced int DEFAULT 0,
  data_source text DEFAULT 'historical_import',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(sku_code, line_name, shift)
);

GRANT SELECT ON public.sku_line_speeds TO authenticated;
GRANT ALL ON public.sku_line_speeds TO service_role;

ALTER TABLE public.sku_line_speeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read sku_line_speeds"
  ON public.sku_line_speeds FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admin/manager can write sku_line_speeds"
  ON public.sku_line_speeds FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE INDEX IF NOT EXISTS idx_sku_line_speeds_lookup
  ON public.sku_line_speeds (sku_code, line_name, shift);
