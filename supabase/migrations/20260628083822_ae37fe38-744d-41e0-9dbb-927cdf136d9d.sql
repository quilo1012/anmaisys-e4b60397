
-- Prediction log for Smart Target continuous learning
CREATE TABLE IF NOT EXISTS public.prediction_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  line text NOT NULL,
  shift text NOT NULL,
  base_target numeric NOT NULL DEFAULT 0,
  carryover_adj numeric NOT NULL DEFAULT 0,
  mtbf_adj numeric NOT NULL DEFAULT 0,
  predicted_target numeric NOT NULL DEFAULT 0,
  applied_target numeric,
  actual_qty numeric,
  error_pct numeric,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_date, line, shift)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.prediction_log TO authenticated;
GRANT ALL ON public.prediction_log TO service_role;

ALTER TABLE public.prediction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prediction_log_select_auth" ON public.prediction_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "prediction_log_admin_manager_write" ON public.prediction_log
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role));

CREATE INDEX IF NOT EXISTS idx_prediction_log_date_line_shift
  ON public.prediction_log (entry_date DESC, line, shift);

DROP TRIGGER IF EXISTS trg_prediction_log_updated_at ON public.prediction_log;
CREATE TRIGGER trg_prediction_log_updated_at
  BEFORE UPDATE ON public.prediction_log
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Trigger: when rag_weekly_entries actual_qty is set/updated, auto-resolve matching prediction
CREATE OR REPLACE FUNCTION public.resolve_prediction_from_rag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _applied numeric;
  _err numeric;
BEGIN
  IF NEW.actual_qty IS NULL OR NEW.actual_qty = 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(applied_target, predicted_target) INTO _applied
  FROM public.prediction_log
  WHERE entry_date = NEW.entry_date AND line = NEW.line AND shift = NEW.shift
  LIMIT 1;

  IF _applied IS NULL OR _applied = 0 THEN
    RETURN NEW;
  END IF;

  _err := ROUND(((NEW.actual_qty - _applied) / _applied * 100.0)::numeric, 2);

  UPDATE public.prediction_log
  SET actual_qty = NEW.actual_qty,
      error_pct = _err,
      resolved = true,
      resolved_at = now(),
      updated_at = now()
  WHERE entry_date = NEW.entry_date AND line = NEW.line AND shift = NEW.shift;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolve_prediction_from_rag ON public.rag_weekly_entries;
CREATE TRIGGER trg_resolve_prediction_from_rag
  AFTER INSERT OR UPDATE OF actual_qty ON public.rag_weekly_entries
  FOR EACH ROW EXECUTE FUNCTION public.resolve_prediction_from_rag();

-- Smart Target compute RPC: returns base, carry-over, MTBF adjustment
CREATE OR REPLACE FUNCTION public.compute_smart_target(
  _entry_date date,
  _line text,
  _shift text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _base numeric := 0;
  _prev_target numeric := 0;
  _prev_actual numeric := 0;
  _deficit numeric := 0;
  _carry numeric := 0;
  _overdue int := 0;
  _mtbf_pct numeric := 0;
  _mtbf_adj numeric := 0;
  _prev_date date;
  _prev_shift text;
  _final numeric := 0;
BEGIN
  -- Base target from rag_weekly_entries
  SELECT COALESCE(plan_qty, 0) INTO _base
  FROM public.rag_weekly_entries
  WHERE entry_date = _entry_date AND line = _line AND shift = _shift
  LIMIT 1;

  -- Previous shift (DAY -> prior NIGHT same date; NIGHT -> same date DAY)
  IF upper(_shift) = 'DAY' THEN
    _prev_date := _entry_date - 1;
    _prev_shift := 'NIGHT';
  ELSE
    _prev_date := _entry_date;
    _prev_shift := 'DAY';
  END IF;

  SELECT COALESCE(plan_qty,0), COALESCE(actual_qty,0)
    INTO _prev_target, _prev_actual
  FROM public.rag_weekly_entries
  WHERE entry_date = _prev_date AND line = _line AND shift = _prev_shift
  LIMIT 1;

  _deficit := GREATEST(_prev_target - _prev_actual, 0);
  _carry := ROUND(_deficit * 0.5);

  -- MTBF risk: count overdue PMs for machines on this line
  SELECT COUNT(*) INTO _overdue
  FROM public.pm_schedules ps
  JOIN public.machines m ON m.id = ps.machine_id
  WHERE ps.next_due_at IS NOT NULL
    AND ps.next_due_at < now()
    AND (
      m.fixed_line = _line OR m.current_line = _line OR m.line = _line
    );

  -- 8% reduction per overdue PM, capped at 24%
  _mtbf_pct := LEAST(_overdue * 0.08, 0.24);
  _mtbf_adj := -ROUND((_base + _carry) * _mtbf_pct);

  _final := GREATEST(_base + _carry + _mtbf_adj, 0);

  RETURN jsonb_build_object(
    'base_target', _base,
    'prev_target', _prev_target,
    'prev_actual', _prev_actual,
    'deficit', _deficit,
    'carryover_adj', _carry,
    'overdue_pms', _overdue,
    'mtbf_pct', _mtbf_pct,
    'mtbf_adj', _mtbf_adj,
    'predicted_target', _final
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_smart_target(date, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.compute_smart_target(date, text, text) TO authenticated;
