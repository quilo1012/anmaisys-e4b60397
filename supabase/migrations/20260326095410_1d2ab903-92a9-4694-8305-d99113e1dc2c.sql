
-- Engineer scores table
CREATE TABLE public.engineer_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_id uuid NOT NULL UNIQUE,
  score integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.engineer_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Engineers see own score" ON public.engineer_scores
  FOR SELECT TO authenticated
  USING (engineer_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "System can upsert scores" ON public.engineer_scores
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'engineer'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'engineer'));

-- WO Messages table for internal chat
CREATE TABLE public.wo_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL,
  user_id uuid NOT NULL,
  user_name text NOT NULL,
  message text NOT NULL DEFAULT '',
  image_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.wo_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view wo messages" ON public.wo_messages
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'engineer')
    OR user_id = auth.uid()
  );

CREATE POLICY "Authenticated can insert wo messages" ON public.wo_messages
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Enable realtime for wo_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.wo_messages;

-- Scoring trigger function
CREATE OR REPLACE FUNCTION public.update_engineer_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _score_delta integer := 0;
  _response_min integer;
  _repair_min integer;
  _sla_target integer;
BEGIN
  -- Only process status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- +10 for fast acceptance (received within 5 min)
  IF NEW.status = 'received' AND NEW.engineer_id IS NOT NULL AND NEW.received_at IS NOT NULL THEN
    _response_min := EXTRACT(EPOCH FROM (NEW.received_at::timestamp - NEW.created_at::timestamp)) / 60;
    IF _response_min <= 5 THEN
      _score_delta := _score_delta + 10;
    END IF;
    -- -15 if response exceeds SLA target
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

  -- +20 for finishing within SLA, -30 if repair > 2 hours
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

  -- Apply score delta
  IF _score_delta != 0 AND NEW.engineer_id IS NOT NULL THEN
    INSERT INTO public.engineer_scores (engineer_id, score, updated_at)
    VALUES (NEW.engineer_id, _score_delta, now())
    ON CONFLICT (engineer_id) DO UPDATE
    SET score = engineer_scores.score + _score_delta, updated_at = now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_engineer_score
  AFTER UPDATE ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_engineer_score();
