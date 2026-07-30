-- Two origins, two rules.
--
-- An order raised by the iTouching poll IS a stopped machine: it only exists
-- because the line reported a maintenance stop code. That never depends on someone
-- ticking a box, so it is decided here rather than trusted from the edge function —
-- a future change to the poller, or a replay of an old payload, cannot quietly stop
-- the stoppage being recorded.
--
-- An order raised by a person is the requester's answer. Half of the 26 raised on
-- the floor between 25/07 and 29/07 said the line was still running — Line 4 said so
-- 5 times out of 7 — and the operator's tablet makes that an explicit red
-- Stopped / Running choice, so the answer is theirs to give and this trigger only
-- stamps what they chose.
--
-- Warehouse service is named explicitly: it must never touch line downtime.

CREATE OR REPLACE FUNCTION public.wo_auto_open_downtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'open'
     AND COALESCE(NEW.wo_type, 'production') <> 'warehouse_service'
     AND ( (NEW.machine IS NOT NULL AND NEW.machine <> '') OR NEW.line_id IS NOT NULL )
     AND NEW.line_stopped_at IS NULL
     -- From iTouching: a maintenance stop code means the machine is down, full stop.
     -- From a person: only if they said so.
     AND (NEW.line_stopped IS TRUE OR NEW.intouch_machine_id IS NOT NULL)
  THEN
    NEW.line_stopped := true;
    NEW.line_stopped_at := COALESCE(NEW.line_stopped_at, NEW.created_at, now());
    NEW.line_stopped_by := COALESCE(NEW.line_stopped_by, NEW.operator_id);
  END IF;
  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION public.wo_auto_open_downtime() IS
  'Opens the stoppage for an order raised by iTouching (a stop code is a stopped machine) or for one where the requester said the line is stopped. Never for warehouse service, and never as an assumption on a person''s behalf.';
