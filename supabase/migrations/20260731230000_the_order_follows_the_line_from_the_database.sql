-- The order follows the line, without waiting for an edge-function deploy.
--
-- The same rule was written into intouch-poll, but edge functions only reach
-- production through a Lovable rebuild, and that is blocked. The poll itself IS
-- running — every minute, successfully — and on every pass it writes what it saw into
-- intouch_machine_map: last_status, last_downtime_code, last_seen_at.
--
-- So the rule can live here instead, reading the poll's own footprints. No deploy, no
-- credits, live on the next poll.
--
-- What it does NOT do is close the order. iTouching knows the machine is running; it
-- does not know whether the repair is finished, and closing carries the maintenance
-- manager's signature.

CREATE OR REPLACE FUNCTION public.intouch_machine_state_moves_the_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _wo record;
  _episodes integer;
  _recovered boolean;
  _stopped_again boolean;
BEGIN
  -- Recovered: the poll cleared the stop code it was carrying.
  _recovered := OLD.last_downtime_code IS NOT NULL AND NEW.last_downtime_code IS NULL;
  -- Stopped again: a code arrived where there was none.
  _stopped_again := OLD.last_downtime_code IS NULL AND NEW.last_downtime_code IS NOT NULL;

  IF NOT _recovered AND NOT _stopped_again THEN RETURN NEW; END IF;

  FOR _wo IN
    SELECT w.id, w.line_stopped, w.line_resumed_at
    FROM public.work_orders w
    WHERE w.intouch_machine_id = NEW.intouch_machine_id
      AND w.status IN ('open', 'received', 'arrived', 'in_progress')
  LOOP
    IF _recovered AND _wo.line_stopped AND _wo.line_resumed_at IS NULL THEN
      UPDATE public.work_orders
         SET line_stopped = false,
             line_resumed_at = COALESCE(NEW.last_seen_at, now())
       WHERE id = _wo.id;

      -- An event left open makes the order un-closable: closing refuses while any
      -- downtime_events row has no resumed_at.
      UPDATE public.downtime_events
         SET resumed_at = COALESCE(NEW.last_seen_at, now()),
             resumed_by_name = 'iTouching',
             resumed_note = 'Machine reported running by iTouching'
       WHERE work_order_id = _wo.id AND resumed_at IS NULL;

    ELSIF _stopped_again AND NOT _wo.line_stopped THEN
      -- The machine failed again before anybody closed the order. A second stoppage,
      -- not a continuation — so the minutes in between, when the line was running, are
      -- not counted as downtime.
      SELECT count(*) INTO _episodes FROM public.downtime_events WHERE work_order_id = _wo.id;

      INSERT INTO public.downtime_events
        (work_order_id, stopped_at, stopped_by_name, stopped_reason, is_recurrence, episode_number)
      VALUES
        (_wo.id, COALESCE(NEW.last_seen_at, now()), 'iTouching',
         COALESCE((SELECT label FROM public.intouch_stop_code_map
                    WHERE lower(stop_code) = lower(NEW.last_downtime_code) LIMIT 1),
                  'iTouching stop'),
         true, _episodes + 1);

      UPDATE public.work_orders
         SET line_stopped = true, line_resumed_at = NULL
       WHERE id = _wo.id;
    END IF;
  END LOOP;

  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION public.intouch_machine_state_moves_the_order() IS
  'Follows intouch_machine_map: when the poll clears a machine''s stop code the order resumes the line; when a code returns, a new stoppage episode is recorded. Never closes the order.';

DROP TRIGGER IF EXISTS trg_intouch_machine_state_moves_the_order ON public.intouch_machine_map;
CREATE TRIGGER trg_intouch_machine_state_moves_the_order
  AFTER UPDATE OF last_downtime_code ON public.intouch_machine_map
  FOR EACH ROW EXECUTE FUNCTION public.intouch_machine_state_moves_the_order();
