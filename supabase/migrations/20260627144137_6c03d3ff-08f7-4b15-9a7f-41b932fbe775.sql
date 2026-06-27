
-- 1) New columns for shift metrics from iTouching
ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS scrap_qty numeric NOT NULL DEFAULT 0;

ALTER TABLE public.production_sessions
  ADD COLUMN IF NOT EXISTS run_time_min  numeric,
  ADD COLUMN IF NOT EXISTS down_time_min numeric,
  ADD COLUMN IF NOT EXISTS oee_pct       numeric,
  ADD COLUMN IF NOT EXISTS metrics_synced_at timestamptz;

-- 2) Propagate RAG Weekly plan_qty changes back to production_items
CREATE OR REPLACE FUNCTION public.sync_items_target_from_rag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _session_id uuid;
  _sum_target numeric;
  _n int;
  _new_plan numeric := COALESCE(NEW.plan_qty, 0);
BEGIN
  IF NEW.plan_qty IS NOT DISTINCT FROM OLD.plan_qty THEN
    RETURN NULL;
  END IF;

  SELECT id INTO _session_id
    FROM public.production_sessions
   WHERE session_date = NEW.entry_date AND line = NEW.line AND shift = NEW.shift
   LIMIT 1;
  IF _session_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(COALESCE(target_qty, planned_qty, 0)), 0), COUNT(*)
    INTO _sum_target, _n
    FROM public.production_items
   WHERE session_id = _session_id;

  IF _n = 0 THEN RETURN NULL; END IF;

  IF _sum_target > 0 THEN
    -- Scale proportionally to existing targets.
    UPDATE public.production_items
       SET target_qty  = ROUND(COALESCE(target_qty, planned_qty, 0) * _new_plan / _sum_target),
           planned_qty = ROUND(COALESCE(target_qty, planned_qty, 0) * _new_plan / _sum_target),
           updated_at  = now()
     WHERE session_id = _session_id;
  ELSE
    -- Even split when no prior target exists.
    UPDATE public.production_items
       SET target_qty  = ROUND(_new_plan / _n),
           planned_qty = ROUND(_new_plan / _n),
           updated_at  = now()
     WHERE session_id = _session_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_items_target_from_rag ON public.rag_weekly_entries;
CREATE TRIGGER trg_sync_items_target_from_rag
AFTER UPDATE OF plan_qty ON public.rag_weekly_entries
FOR EACH ROW EXECUTE FUNCTION public.sync_items_target_from_rag();
