-- Preventive work: maintenance planned into a window where the line is not running.
--
-- Every work order on file today is reactive — something broke, somebody asked for
-- it to be fixed, and the line was usually stopped while it happened. There is no way
-- to record the opposite: a job taken deliberately into a planned window, on a line
-- that is not producing, precisely so it never becomes a breakdown.
--
-- wo_type is the right place for it. The column already separates 'warehouse_service'
-- from 'production' and the downtime trigger already reads it, so a third value costs
-- nothing structurally. It was NOT free text — the CHECK constraint allowed exactly
-- two values, and an insert of 'preventive' was refused by the database.

ALTER TABLE public.work_orders DROP CONSTRAINT IF EXISTS work_orders_wo_type_check;
ALTER TABLE public.work_orders
  ADD CONSTRAINT work_orders_wo_type_check
  CHECK (wo_type = ANY (ARRAY['production'::text, 'warehouse_service'::text, 'preventive'::text]));

COMMENT ON COLUMN public.work_orders.wo_type IS
  'production = reactive work on a line · warehouse_service = never touches a line · preventive = planned work in a non-producing window, accrues no downtime.';

-- A preventive order never opens downtime.
--
-- The point of planning the work into a window where the line is idle is that the
-- factory loses nothing by it. If a preventive order booked downtime, the leader who
-- did the responsible thing would show a worse day than the one who waited for the
-- breakdown — which is precisely the behaviour this is meant to encourage away from.
--
-- Same treatment 'warehouse_service' already gets, and the iTouching override does
-- not reach it: a stop iTouching reports is a real stop and opens its own downtime
-- row through the poll, not through this trigger.
CREATE OR REPLACE FUNCTION public.wo_auto_open_downtime()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'open'
     AND COALESCE(NEW.wo_type, 'production') NOT IN ('warehouse_service', 'preventive')
     AND ( (NEW.machine IS NOT NULL AND NEW.machine <> '') OR NEW.line_id IS NOT NULL )
     AND NEW.line_stopped_at IS NULL
     AND (NEW.line_stopped IS TRUE OR NEW.intouch_machine_id IS NOT NULL)
  THEN
    NEW.line_stopped := true;
    NEW.line_stopped_at := COALESCE(NEW.line_stopped_at, NEW.created_at, now());
    NEW.line_stopped_by := COALESCE(NEW.line_stopped_by, NEW.operator_id);
  END IF;
  RETURN NEW;
END
$function$;

-- Belt and braces: a preventive order cannot carry the stop columns at all, however
-- it was created. The rule lives here rather than only in the screen that creates
-- them, because an import or a fix-up UPDATE would otherwise walk straight past it.
CREATE OR REPLACE FUNCTION public.preventive_wo_never_stops_the_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.wo_type, 'production') = 'preventive' THEN
    NEW.line_stopped := false;
    NEW.line_stopped_at := NULL;
    NEW.line_stopped_by := NULL;
    NEW.line_resumed_at := NULL;
    NEW.line_resumed_by := NULL;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_preventive_wo_never_stops_the_line ON public.work_orders;
CREATE TRIGGER trg_preventive_wo_never_stops_the_line
  BEFORE INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.preventive_wo_never_stops_the_line();
