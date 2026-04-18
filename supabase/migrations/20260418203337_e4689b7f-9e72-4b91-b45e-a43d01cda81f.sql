-- Phase A: WO Episodes (parallel to old recurrence flow)

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_episode INTEGER NOT NULL DEFAULT 1;

-- No FK on engineer columns: some legacy work_orders reference user IDs
-- that don't have a row in public.profiles, which would break backfill.
CREATE TABLE IF NOT EXISTS public.wo_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reopened_by UUID,
  reopen_reason TEXT,
  accepted_at TIMESTAMPTZ,
  arrived_at TIMESTAMPTZ,
  started_work_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  finish_engineer_id UUID,
  finish_pin_verified BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  UNIQUE (work_order_id, episode_number)
);

CREATE INDEX IF NOT EXISTS idx_wo_episodes_wo ON public.wo_episodes(work_order_id);

ALTER TABLE public.wo_episodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wo_episodes_select_auth" ON public.wo_episodes;
DROP POLICY IF EXISTS "wo_episodes_insert_auth" ON public.wo_episodes;
DROP POLICY IF EXISTS "wo_episodes_update_auth" ON public.wo_episodes;

CREATE POLICY "wo_episodes_select_auth"
  ON public.wo_episodes FOR SELECT TO authenticated USING (true);
CREATE POLICY "wo_episodes_insert_auth"
  ON public.wo_episodes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "wo_episodes_update_auth"
  ON public.wo_episodes FOR UPDATE TO authenticated USING (true);

-- Backfill: 1 episode for every existing WO
INSERT INTO public.wo_episodes
  (work_order_id, episode_number, started_at, accepted_at,
   arrived_at, started_work_at, finished_at, finish_engineer_id,
   finish_pin_verified)
SELECT wo.id, 1, wo.created_at, wo.received_at,
       wo.arrived_at, wo.started_at, wo.finished_at, wo.engineer_id,
       (wo.finished_at IS NOT NULL)
FROM public.work_orders wo
WHERE NOT EXISTS (
  SELECT 1 FROM public.wo_episodes e WHERE e.work_order_id = wo.id
);

ALTER TABLE public.downtime_events
  ADD COLUMN IF NOT EXISTS episode_number INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.reopen_wo_recurrence(
  _wo_id UUID,
  _reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  _user_id UUID := auth.uid();
  _new_episode INT;
  _prev_engineer UUID;
  _prev_engineer_name TEXT;
  _wo_status TEXT;
  _current_ep INT;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT status::text, engineer_id, engineer_name, current_episode
    INTO _wo_status, _prev_engineer, _prev_engineer_name, _current_ep
    FROM public.work_orders WHERE id = _wo_id;

  IF _wo_status IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'wo_not_found');
  END IF;

  IF _wo_status NOT IN ('finished', 'closed', 'completed') THEN
    RETURN jsonb_build_object('success', false,
      'error', 'wo_not_closed_use_stopped_again');
  END IF;

  UPDATE public.wo_episodes
    SET finished_at = COALESCE(finished_at, now())
    WHERE work_order_id = _wo_id AND episode_number = _current_ep;

  SELECT COALESCE(MAX(episode_number), 0) + 1 INTO _new_episode
    FROM public.wo_episodes WHERE work_order_id = _wo_id;

  INSERT INTO public.wo_episodes
    (work_order_id, episode_number, reopened_by, reopen_reason, accepted_at)
  VALUES (_wo_id, _new_episode, _user_id, _reason, now());

  UPDATE public.work_orders SET
    status = 'received'::wo_status,
    reopen_count = reopen_count + 1,
    current_episode = _new_episode,
    locked_engineer_id = _prev_engineer,
    engineer_id = _prev_engineer,
    engineer_name = _prev_engineer_name,
    received_at = now(),
    finished_at = NULL,
    closed_at = NULL,
    signed_by_name = NULL
  WHERE id = _wo_id;

  INSERT INTO public.downtime_events
    (work_order_id, stopped_at, stopped_by, stopped_reason,
     is_recurrence, episode_number)
  VALUES (_wo_id, now(), _user_id, _reason, true, _new_episode);

  RETURN jsonb_build_object('success', true,
    'episode_number', _new_episode,
    'engineer_id', _prev_engineer);
END;
$$;

GRANT EXECUTE ON FUNCTION public.reopen_wo_recurrence(UUID, TEXT) TO authenticated;