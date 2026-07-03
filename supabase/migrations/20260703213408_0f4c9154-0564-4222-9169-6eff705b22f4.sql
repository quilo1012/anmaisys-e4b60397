
-- Fix 4: SKU production history table for AI speed suggestions
CREATE TABLE public.sku_production_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.lines(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES public.sku_products(id) ON DELETE CASCADE,
  session_date date NOT NULL,
  shift text NOT NULL CHECK (shift IN ('DAY','NIGHT')),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  run_minutes integer NOT NULL DEFAULT 0 CHECK (run_minutes >= 0),
  units_per_hour numeric GENERATED ALWAYS AS (
    CASE WHEN run_minutes > 0 THEN (quantity::numeric * 60.0 / run_minutes::numeric) ELSE 0 END
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_id, sku_id, session_date, shift)
);

GRANT SELECT ON public.sku_production_history TO authenticated;
GRANT ALL ON public.sku_production_history TO service_role;

ALTER TABLE public.sku_production_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view sku history"
  ON public.sku_production_history FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and managers manage sku history"
  ON public.sku_production_history FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role));

CREATE INDEX idx_sku_history_lookup ON public.sku_production_history (line_id, sku_id, session_date DESC);

CREATE TRIGGER trg_sku_history_updated_at
  BEFORE UPDATE ON public.sku_production_history
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-populate from production_items when actual_qty changes
CREATE OR REPLACE FUNCTION public.sync_sku_history_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sess record;
  _line_id uuid;
  _dt integer;
  _run integer;
BEGIN
  IF NEW.actual_qty IS NULL OR NEW.actual_qty <= 0 OR NEW.sku_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT session_date, line, shift INTO _sess
    FROM public.production_sessions WHERE id = NEW.session_id;
  IF _sess.session_date IS NULL THEN RETURN NULL; END IF;

  SELECT id INTO _line_id FROM public.lines WHERE name = _sess.line LIMIT 1;
  IF _line_id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(downtime_min, 0) INTO _dt
    FROM public.rag_weekly_entries
    WHERE entry_date = _sess.session_date AND line = _sess.line AND shift = _sess.shift
    LIMIT 1;

  _run := GREATEST(60, 720 - COALESCE(_dt, 0));

  INSERT INTO public.sku_production_history (line_id, sku_id, session_date, shift, quantity, run_minutes)
  VALUES (_line_id, NEW.sku_id, _sess.session_date, _sess.shift, NEW.actual_qty, _run)
  ON CONFLICT (line_id, sku_id, session_date, shift) DO UPDATE
    SET quantity = EXCLUDED.quantity,
        run_minutes = EXCLUDED.run_minutes,
        updated_at = now();
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_sku_history
  AFTER INSERT OR UPDATE OF actual_qty ON public.production_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_sku_history_from_item();

-- RPC returning avg units_per_hour over trailing window
CREATE OR REPLACE FUNCTION public.get_sku_speed_suggestion(_line_id uuid, _sku_id uuid, _days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH d AS (
    SELECT units_per_hour, session_date
    FROM public.sku_production_history
    WHERE line_id = _line_id
      AND sku_id = _sku_id
      AND session_date >= (current_date - GREATEST(_days, 1))
      AND units_per_hour > 0
  )
  SELECT jsonb_build_object(
    'avg_uph', COALESCE(ROUND(AVG(units_per_hour))::int, 0),
    'sample_size', COUNT(*)::int,
    'window_days', _days
  ) FROM d;
$$;

-- Backfill from existing production_items (best-effort, ignore missing line links)
INSERT INTO public.sku_production_history (line_id, sku_id, session_date, shift, quantity, run_minutes)
SELECT l.id, pi.sku_id, ps.session_date, ps.shift, pi.actual_qty,
  GREATEST(60, 720 - COALESCE(rwe.downtime_min, 0))
FROM public.production_items pi
JOIN public.production_sessions ps ON ps.id = pi.session_id
JOIN public.lines l ON l.name = ps.line
LEFT JOIN public.rag_weekly_entries rwe
  ON rwe.entry_date = ps.session_date AND rwe.line = ps.line AND rwe.shift = ps.shift
WHERE pi.actual_qty > 0
  AND pi.sku_id IS NOT NULL
  AND ps.session_date >= (current_date - 60)
ON CONFLICT (line_id, sku_id, session_date, shift) DO NOTHING;
