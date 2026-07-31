-- A shift ending is not a breakdown, and neither is a break.
--
-- The rule written yesterday treated ANY stop code as a stoppage: code appears, the
-- order's clock restarts. Which meant that at the end of the shift, when iTouching
-- reports "No Planned Shift" on a line whose order is still open, the order would
-- have started counting again — and gone on counting all night.
--
-- That is exactly the shape of the 233,710 phantom minutes this system had to cap by
-- hand a few days ago: a clock nobody stopped, against a line nobody was working on.
-- Found before it happened, by asking why an order showed the line running while an
-- iTouching screen showed No Planned Shift.
--
-- So the trigger now asks whether the code is a FAULT — one the factory has marked
-- requires_wo, and that iTouching does not flag as planned — rather than merely
-- whether a code exists.
--
-- It also treats a fault being REPLACED by a planned code as the fault ending. When
-- a line goes from Drill Fault to No Planned Shift, nobody is repairing anything at
-- 2am; the clock stops there rather than running to morning.

CREATE OR REPLACE FUNCTION public.intouch_is_fault_code(_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT requires_wo FROM public.intouch_stop_code_map WHERE lower(stop_code) = lower(_code) LIMIT 1),
    false)
   AND NOT COALESCE(
    (SELECT c.planned FROM public.intouch_stop_code_catalog c
      JOIN public.intouch_stop_code_map m2 ON lower(m2.stop_code) = lower(_code)
     WHERE lower(btrim(c.name)) = lower(btrim(m2.label)) LIMIT 1), false);
$function$;

COMMENT ON FUNCTION public.intouch_is_fault_code(text) IS
  'True only for stop codes that mean a breakdown: flagged requires_wo by the factory and not marked Planned in iTouching. Breaks, Changeover and No Planned Shift are false.';

-- Verified against the live catalogue: Drill Fault true, Breaks false,
-- No Planned Shift false. And against the live data, in transactions that were
-- rolled back: No Planned Shift arriving on Line 2 leaves WO-633 running with one
-- episode; a Capper Fault arriving stops it and opens episode 2 named for the fault.

CREATE OR REPLACE FUNCTION public.intouch_machine_state_moves_the_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _wo record;
  _episodes integer;
  _was_fault boolean;
  _is_fault boolean;
  _recovered boolean;
  _stopped_again boolean;
  _when timestamptz;
  _note constant text := 'iTouching stopped reporting a fault on this machine. It does not distinguish a repaired machine from one whose team has gone on break, or a shift that has ended — the repair may still be outstanding.';
BEGIN
  _was_fault := OLD.last_downtime_code IS NOT NULL AND public.intouch_is_fault_code(OLD.last_downtime_code);
  _is_fault  := NEW.last_downtime_code IS NOT NULL AND public.intouch_is_fault_code(NEW.last_downtime_code);

  -- The fault stopped being reported: cleared, or replaced by a planned code such as
  -- No Planned Shift or Breaks. Either way the clock stops.
  _recovered := _was_fault AND NOT _is_fault;
  -- A fault appeared. Planned codes never restart an order's clock.
  _stopped_again := _is_fault AND NOT _was_fault;

  IF NOT _recovered AND NOT _stopped_again THEN RETURN NEW; END IF;
  _when := COALESCE(NEW.last_seen_at, now());

  FOR _wo IN
    SELECT w.id, w.line_stopped, w.line_resumed_at FROM public.work_orders w
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
