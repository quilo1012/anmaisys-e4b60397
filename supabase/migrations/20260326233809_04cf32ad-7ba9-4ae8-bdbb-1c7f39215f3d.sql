
-- Add health_score to machines
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS health_score integer NOT NULL DEFAULT 100;

-- Function to recalculate health scores
CREATE OR REPLACE FUNCTION public.recalculate_health_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _machine_name text;
  _wo_count integer;
  _long_repair_count integer;
  _recurrent_count integer;
  _score integer;
BEGIN
  _machine_name := COALESCE(NEW.machine, OLD.machine);
  
  -- Count WOs in last 30 days
  SELECT COUNT(*) INTO _wo_count
  FROM work_orders
  WHERE machine = _machine_name
    AND created_at >= now() - interval '30 days';
  
  -- Count WOs with repair > 120 min in last 30 days
  SELECT COUNT(*) INTO _long_repair_count
  FROM work_orders
  WHERE machine = _machine_name
    AND created_at >= now() - interval '30 days'
    AND started_at IS NOT NULL
    AND finished_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (finished_at - started_at)) / 60 > 120;
  
  -- Count recurrent problems (same problem >= 3 times in 30 days)
  SELECT COUNT(*) INTO _recurrent_count
  FROM (
    SELECT description, COUNT(*) as cnt
    FROM work_orders
    WHERE machine = _machine_name
      AND created_at >= now() - interval '30 days'
    GROUP BY description
    HAVING COUNT(*) >= 3
  ) sub;
  
  -- Calculate score: 100 - 5*wo_count - 10*long_repairs - 15*recurrent
  _score := GREATEST(0, 100 - (_wo_count * 5) - (_long_repair_count * 10) - (_recurrent_count * 15));
  
  -- Update machine health score
  UPDATE machines SET health_score = _score WHERE name = _machine_name;
  
  RETURN NEW;
END;
$$;

-- Trigger on work_orders status changes
CREATE TRIGGER trg_recalculate_health
AFTER INSERT OR UPDATE OF status ON work_orders
FOR EACH ROW
EXECUTE FUNCTION recalculate_health_scores();
