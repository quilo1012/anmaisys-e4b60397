-- A stoppage belongs to the shift it happened in.
--
-- An order raised at 15:00 on days could, until now, collect a fresh stoppage at 02:00
-- the next morning and carry it as a recurrence. That puts the night team's stoppage
-- on the day team's order, and on the day team's numbers — and the order's own
-- downtime total stops meaning anything, because it spans two shifts that are
-- reported separately everywhere else in this system.
--
-- Shifts are the factory's: DAY 06:00–18:00, NIGHT 18:00–06:00, Europe/London, with
-- the small hours belonging to the night that started the evening before. Same
-- boundary the production log, the RAG plan and the downtime capping already use.

CREATE OR REPLACE FUNCTION public.factory_shift_key(_ts timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  WITH london AS (SELECT (_ts AT TIME ZONE 'Europe/London') AS lt)
  SELECT CASE
    WHEN EXTRACT(HOUR FROM lt) >= 6 AND EXTRACT(HOUR FROM lt) < 18
      THEN to_char(lt, 'YYYY-MM-DD') || ' DAY'
    WHEN EXTRACT(HOUR FROM lt) >= 18
      THEN to_char(lt, 'YYYY-MM-DD') || ' NIGHT'
    -- 00:00–05:59 belongs to the night that began the previous evening.
    ELSE to_char(lt - interval '1 day', 'YYYY-MM-DD') || ' NIGHT'
  END FROM london;
$function$;

COMMENT ON FUNCTION public.factory_shift_key(timestamptz) IS
  'The factory shift a moment belongs to, e.g. "2026-07-31 NIGHT". DAY 06:00-18:00, NIGHT 18:00-06:00, Europe/London.';

/**
 * Guard, not a preference.
 *
 * Placed on the table rather than in the callers because there are three of them —
 * the iTouching trigger, the poll, and the engineer pressing LINE STOPPED AGAIN — and
 * a rule enforced in three places is a rule enforced in two of them by next month.
 *
 * It raises rather than silently dropping the row: whoever pressed the button needs
 * to know why nothing happened, and the message says what to do instead.
 */
CREATE OR REPLACE FUNCTION public.recurrence_stays_in_its_shift()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE _first timestamptz; _order_shift text; _this_shift text;
BEGIN
  IF NOT COALESCE(NEW.is_recurrence, false) THEN RETURN NEW; END IF;

  SELECT LEAST(
           COALESCE(w.line_stopped_at, w.created_at),
           COALESCE((SELECT min(e.stopped_at) FROM public.downtime_events e
                      WHERE e.work_order_id = NEW.work_order_id), w.created_at))
    INTO _first
    FROM public.work_orders w WHERE w.id = NEW.work_order_id;

  IF _first IS NULL THEN RETURN NEW; END IF;

  _order_shift := public.factory_shift_key(_first);
  _this_shift  := public.factory_shift_key(COALESCE(NEW.stopped_at, now()));

  IF _order_shift <> _this_shift THEN
    RAISE EXCEPTION 'This stoppage is on the % shift and the order belongs to %. A stoppage in another shift needs its own order.',
      _this_shift, _order_shift;
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_recurrence_stays_in_its_shift ON public.downtime_events;
CREATE TRIGGER trg_recurrence_stays_in_its_shift
  BEFORE INSERT ON public.downtime_events
  FOR EACH ROW EXECUTE FUNCTION public.recurrence_stays_in_its_shift();

-- The iTouching trigger checks the same rule before it inserts, so the poll skips the
-- order quietly instead of failing its own update on an exception it cannot handle.
-- (Function body updated in place — see 20260731230000.)

-- And the iTouching trigger checks it before inserting, so the poll's own update is
-- never aborted by an exception it has no way to handle: the order from the other
-- shift is simply left alone.
CREATE OR REPLACE FUNCTION public.intouch_machine_state_moves_the_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _wo record; _episodes integer; _was_fault boolean; _is_fault boolean;
  _recovered boolean; _stopped_again boolean; _when timestamptz; _first timestamptz;
  _note constant text := 'iTouching stopped reporting a fault on this machine. It does not distinguish a repaired machine from one whose team has gone on break, or a shift that has ended — the repair may still be outstanding.';
BEGIN
  _was_fault := OLD.last_downtime_code IS NOT NULL AND public.intouch_is_fault_code(OLD.last_downtime_code);
  _is_fault  := NEW.last_downtime_code IS NOT NULL AND public.intouch_is_fault_code(NEW.last_downtime_code);
  _recovered := _was_fault AND NOT _is_fault;
  _stopped_again := _is_fault AND NOT _was_fault;
  IF NOT _recovered AND NOT _stopped_again THEN RETURN NEW; END IF;
  _when := COALESCE(NEW.last_seen_at, now());

  FOR _wo IN
    SELECT w.id, w.line_stopped, w.line_resumed_at, w.line_stopped_at, w.created_at
    FROM public.work_orders w
    WHERE w.intouch_machine_id = NEW.intouch_machine_id
      AND w.status IN ('open', 'received', 'arrived', 'in_progress')
  LOOP
    IF _recovered AND _wo.line_stopped AND _wo.line_resumed_at IS NULL THEN
      UPDATE public.work_orders SET line_stopped = false, line_resumed_at = _when WHERE id = _wo.id;
      UPDATE public.downtime_events
         SET resumed_by_name = COALESCE(resumed_by_name, 'iTouching'),
             resumed_note = COALESCE(resumed_note, _note)
       WHERE work_order_id = _wo.id AND resumed_by_name IS NULL AND resumed_at IS NOT NULL;

    ELSIF _stopped_again AND NOT _wo.line_stopped THEN
      _first := LEAST(
        COALESCE(_wo.line_stopped_at, _wo.created_at),
        COALESCE((SELECT min(e.stopped_at) FROM public.downtime_events e WHERE e.work_order_id = _wo.id), _wo.created_at));
      IF public.factory_shift_key(_first) IS DISTINCT FROM public.factory_shift_key(_when) THEN
        CONTINUE;
      END IF;

      SELECT count(*) INTO _episodes FROM public.downtime_events WHERE work_order_id = _wo.id;
      INSERT INTO public.downtime_events
        (work_order_id, stopped_at, stopped_by_name, stopped_reason, is_recurrence, episode_number)
      VALUES
        (_wo.id, _when, 'iTouching',
         COALESCE((SELECT label FROM public.intouch_stop_code_map
                    WHERE lower(stop_code) = lower(NEW.last_downtime_code) LIMIT 1), 'iTouching stop'),
         true, _episodes + 1);
      UPDATE public.work_orders SET line_stopped = true, line_resumed_at = NULL WHERE id = _wo.id;
    END IF;
  END LOOP;

  RETURN NEW;
END
$function$;

-- Verified against the live data, in transactions that were rolled back:
--   · WO-633 belongs to 2026-07-31 DAY. A recurrence stamped now (NIGHT) is refused
--     with "A stoppage in another shift needs its own order."
--   · WO-634 belongs to 2026-07-31 NIGHT. The same insert is accepted.
