
-- 1) Auto-mark line stopped on WO create when a machine/line is attached
CREATE OR REPLACE FUNCTION public.wo_auto_open_downtime()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'open'
     AND ( (NEW.machine IS NOT NULL AND NEW.machine <> '') OR NEW.line_id IS NOT NULL )
     AND NEW.line_stopped_at IS NULL THEN
    NEW.line_stopped := true;
    NEW.line_stopped_at := COALESCE(NEW.line_stopped_at, NEW.created_at, now());
    NEW.line_stopped_by := COALESCE(NEW.line_stopped_by, NEW.operator_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wo_auto_open_downtime ON public.work_orders;
CREATE TRIGGER trg_wo_auto_open_downtime
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.wo_auto_open_downtime();

-- 2) After WO insert, create matching downtime_events row
CREATE OR REPLACE FUNCTION public.wo_auto_insert_downtime_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.line_stopped_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.downtime_events WHERE work_order_id = NEW.id) THEN
    INSERT INTO public.downtime_events
      (work_order_id, stopped_at, stopped_by, stopped_by_name, stopped_reason, episode_number)
    VALUES
      (NEW.id, NEW.line_stopped_at, NEW.line_stopped_by, NEW.requester_name,
       COALESCE(NULLIF(NEW.description, ''), 'Line stopped'), COALESCE(NEW.current_episode, 1));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wo_auto_insert_downtime_event ON public.work_orders;
CREATE TRIGGER trg_wo_auto_insert_downtime_event
  AFTER INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.wo_auto_insert_downtime_event();

-- 3) On WO finish, close line + close open downtime_events row
CREATE OR REPLACE FUNCTION public.wo_auto_close_downtime()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('finished','closed','completed','force_closed')
     AND (OLD.status IS DISTINCT FROM NEW.status)
     AND NEW.finished_at IS NOT NULL THEN

    IF NEW.line_resumed_at IS NULL AND NEW.line_stopped_at IS NOT NULL THEN
      NEW.line_resumed_at := NEW.finished_at;
      NEW.line_resumed_by := COALESCE(NEW.line_resumed_by, NEW.engineer_id, NEW.closed_by);
      NEW.line_stopped := false;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wo_auto_close_downtime ON public.work_orders;
CREATE TRIGGER trg_wo_auto_close_downtime
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.wo_auto_close_downtime();

CREATE OR REPLACE FUNCTION public.wo_auto_close_downtime_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.line_resumed_at IS NOT NULL
     AND (OLD.line_resumed_at IS DISTINCT FROM NEW.line_resumed_at) THEN
    UPDATE public.downtime_events
       SET resumed_at = NEW.line_resumed_at,
           resumed_by = COALESCE(resumed_by, NEW.line_resumed_by),
           resumed_by_name = COALESCE(resumed_by_name, NEW.engineer_name, NEW.signed_by_name)
     WHERE work_order_id = NEW.id
       AND resumed_at IS NULL;

    -- If none existed (older WO), create a fully-closed one
    IF NOT EXISTS (SELECT 1 FROM public.downtime_events WHERE work_order_id = NEW.id) 
       AND NEW.line_stopped_at IS NOT NULL THEN
      INSERT INTO public.downtime_events
        (work_order_id, stopped_at, stopped_by, stopped_by_name, stopped_reason,
         resumed_at, resumed_by, resumed_by_name, episode_number)
      VALUES
        (NEW.id, NEW.line_stopped_at, NEW.line_stopped_by, NEW.requester_name,
         COALESCE(NULLIF(NEW.description, ''), 'Line stopped'),
         NEW.line_resumed_at, NEW.line_resumed_by,
         COALESCE(NEW.engineer_name, NEW.signed_by_name),
         COALESCE(NEW.current_episode, 1));
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wo_auto_close_downtime_event ON public.work_orders;
CREATE TRIGGER trg_wo_auto_close_downtime_event
  AFTER UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.wo_auto_close_downtime_event();

-- 4) Backfill historical finished WOs with machine/line but no downtime_events
DO $$
DECLARE
  wo_rec record;
  cnt int := 0;
BEGIN
  FOR wo_rec IN
    SELECT id, created_at, finished_at, engineer_id, closed_by, operator_id,
           engineer_name, signed_by_name, requester_name, description, current_episode
    FROM public.work_orders wo
    WHERE status IN ('finished','closed','completed','force_closed')
      AND finished_at IS NOT NULL
      AND ((machine IS NOT NULL AND machine <> '') OR line_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM public.downtime_events de WHERE de.work_order_id = wo.id)
  LOOP
    UPDATE public.work_orders
       SET line_stopped_at = COALESCE(line_stopped_at, wo_rec.created_at),
           line_stopped_by = COALESCE(line_stopped_by, wo_rec.operator_id),
           line_resumed_at = COALESCE(line_resumed_at, wo_rec.finished_at),
           line_resumed_by = COALESCE(line_resumed_by, wo_rec.engineer_id, wo_rec.closed_by),
           line_stopped = false
     WHERE id = wo_rec.id;

    -- The AFTER UPDATE trigger above will create the closed downtime_events row.
    cnt := cnt + 1;
  END LOOP;
  RAISE NOTICE 'Backfilled % work orders', cnt;
END $$;
