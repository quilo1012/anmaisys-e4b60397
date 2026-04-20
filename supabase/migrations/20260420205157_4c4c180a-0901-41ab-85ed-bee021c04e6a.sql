
-- Clamp existing scores
UPDATE public.engineer_scores SET score = 100 WHERE score > 100;
UPDATE public.engineer_scores SET score = 0 WHERE score < 0;

-- Recreate trigger function with clamping
CREATE OR REPLACE FUNCTION public.update_engineer_score()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _score_delta integer := 0;
  _response_min integer;
  _repair_min integer;
  _sla_target integer;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'received' AND NEW.engineer_id IS NOT NULL AND NEW.received_at IS NOT NULL THEN
    _response_min := EXTRACT(EPOCH FROM (NEW.received_at::timestamp - NEW.created_at::timestamp)) / 60;
    IF _response_min <= 5 THEN
      _score_delta := _score_delta + 10;
    END IF;
    _sla_target := CASE NEW.priority
      WHEN 'critical' THEN 10
      WHEN 'high' THEN 30
      WHEN 'low' THEN 120
      ELSE 60
    END;
    IF _response_min > _sla_target THEN
      _score_delta := _score_delta - 15;
    END IF;
  END IF;

  IF NEW.status = 'finished' AND NEW.engineer_id IS NOT NULL AND NEW.started_at IS NOT NULL AND NEW.finished_at IS NOT NULL THEN
    _repair_min := EXTRACT(EPOCH FROM (NEW.finished_at::timestamp - NEW.started_at::timestamp)) / 60;
    _sla_target := CASE NEW.priority
      WHEN 'critical' THEN 10
      WHEN 'high' THEN 30
      WHEN 'low' THEN 120
      ELSE 60
    END;
    IF _repair_min <= _sla_target THEN
      _score_delta := _score_delta + 20;
    END IF;
    IF _repair_min > 120 THEN
      _score_delta := _score_delta - 30;
    END IF;
  END IF;

  IF _score_delta != 0 AND NEW.engineer_id IS NOT NULL THEN
    INSERT INTO public.engineer_scores (engineer_id, score, updated_at)
    VALUES (NEW.engineer_id, GREATEST(0, LEAST(100, _score_delta)), now())
    ON CONFLICT (engineer_id) DO UPDATE
    SET score = GREATEST(0, LEAST(100, engineer_scores.score + _score_delta)),
        updated_at = now();
  END IF;

  RETURN NEW;
END;
$function$;

-- Add a CHECK constraint to enforce 0..100 at the column level
ALTER TABLE public.engineer_scores DROP CONSTRAINT IF EXISTS engineer_scores_score_range;
ALTER TABLE public.engineer_scores ADD CONSTRAINT engineer_scores_score_range CHECK (score >= 0 AND score <= 100);
