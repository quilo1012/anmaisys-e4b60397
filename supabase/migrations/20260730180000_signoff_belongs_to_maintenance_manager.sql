-- Closing an order is the maintenance manager's decision, and so is the downtime
-- that goes with it.
--
-- Three things this settles:
--
-- 1. The maintenance manager could not close anything. work_orders had UPDATE
--    policies for admin, manager, supervisor, engineer, co_engineer and
--    production_office_admin — and none for maintenance_manager. The role the
--    sign-off belongs to was the one role that could not perform it.
--
-- 2. The 24-hour auto-close is switched off. It was closing orders nobody had
--    reviewed, which is the opposite of a sign-off. Finished orders now wait for a
--    person, and the board says who they are waiting for.
--
-- 3. Only admin and maintenance_manager may sign an order off or force close it.
--    Engineers finish work; they do not judge their own work, and they do not decide
--    whether the stoppage counts. Enforced by trigger rather than policy because
--    engineer, manager and supervisor all hold blanket UPDATE on work_orders — a
--    policy cannot say "you may update this row but not into this status".

CREATE POLICY "Maintenance managers can update WOs"
ON public.work_orders FOR UPDATE
USING (has_role(auth.uid(), 'maintenance_manager'))
WITH CHECK (has_role(auth.uid(), 'maintenance_manager'));

-- Finished orders wait for a person now.
SELECT cron.unschedule('auto-close-finished-wos')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-finished-wos');

CREATE OR REPLACE FUNCTION public.enforce_wo_close_signoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- Backend work (cron, edge functions on the service key) has no auth.uid(); RLS
  -- already keeps anon out, so this only exempts trusted server paths.
  IF _uid IS NULL THEN RETURN new; END IF;

  IF new.status IN ('closed', 'force_closed')
     AND old.status IS DISTINCT FROM new.status
     AND NOT (has_role(_uid, 'admin') OR has_role(_uid, 'maintenance_manager')) THEN
    RAISE EXCEPTION 'Only the maintenance manager or an admin can close a maintenance order.';
  END IF;

  RETURN new;
END
$function$;

DROP TRIGGER IF EXISTS trg_wo_close_signoff ON public.work_orders;
CREATE TRIGGER trg_wo_close_signoff
BEFORE UPDATE ON public.work_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_wo_close_signoff();

-- Force close loses 'manager': production managers raise and chase orders, the
-- maintenance manager closes them.
CREATE OR REPLACE FUNCTION public.force_close_work_order(
  _wo_id uuid,
  _line_was_stopped boolean,
  _note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _wo record;
  _discarded_min numeric := 0;
  _discarded_rows integer := 0;
BEGIN
  IF NOT (has_role(_uid, 'admin') OR has_role(_uid, 'maintenance_manager')) THEN
    RAISE EXCEPTION 'Only the maintenance manager or an admin can force close a maintenance order.';
  END IF;

  SELECT * INTO _wo FROM public.work_orders WHERE id = _wo_id;
  IF _wo.id IS NULL THEN
    RAISE EXCEPTION 'Maintenance order not found.';
  END IF;

  IF _line_was_stopped THEN
    UPDATE public.work_orders
    SET status = 'force_closed',
        closed_by = _uid,
        completed_at = now(),
        finished_at = now(),
        notes = CASE WHEN _note IS NULL OR btrim(_note) = '' THEN notes
                     ELSE COALESCE(notes || E'\n', '') || _note END,
        line_stopped = CASE WHEN line_stopped AND line_resumed_at IS NULL THEN false ELSE line_stopped END,
        line_resumed_at = CASE WHEN line_stopped AND line_resumed_at IS NULL THEN now() ELSE line_resumed_at END,
        line_resumed_by = CASE WHEN line_stopped AND line_resumed_at IS NULL THEN _uid ELSE line_resumed_by END
    WHERE id = _wo_id;
  ELSE
    SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (now() - stopped_at)) / 60), 0), COUNT(*)
    INTO _discarded_min, _discarded_rows
    FROM public.downtime_events
    WHERE work_order_id = _wo_id AND resumed_at IS NULL;

    DELETE FROM public.downtime_events
    WHERE work_order_id = _wo_id AND resumed_at IS NULL;

    UPDATE public.work_orders
    SET status = 'force_closed',
        closed_by = _uid,
        completed_at = now(),
        finished_at = now(),
        notes = CASE WHEN _note IS NULL OR btrim(_note) = '' THEN notes
                     ELSE COALESCE(notes || E'\n', '') || _note END,
        line_stopped = false,
        line_stopped_at = NULL,
        line_resumed_at = NULL,
        line_resumed_by = NULL
    WHERE id = _wo_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    _uid,
    COALESCE((SELECT name FROM public.profiles WHERE id = _uid), 'Unknown'),
    'force_close',
    'work_order',
    _wo_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('status', _wo.status, 'line_stopped', _wo.line_stopped, 'line_stopped_at', _wo.line_stopped_at),
      'after', jsonb_build_object('status', 'force_closed'),
      'line_was_stopped', _line_was_stopped,
      'downtime_events_discarded', _discarded_rows,
      'downtime_minutes_discarded', round(_discarded_min, 1),
      'note', _note
    )
  );

  RETURN jsonb_build_object(
    'wo_number', _wo.wo_number,
    'line_was_stopped', _line_was_stopped,
    'downtime_events_discarded', _discarded_rows,
    'downtime_minutes_discarded', round(_discarded_min, 1)
  );
END
$function$;

REVOKE ALL ON FUNCTION public.force_close_work_order(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.force_close_work_order(uuid, boolean, text) TO authenticated;

-- An order nobody accepted had no way out but waiting. WO-605 sat open from 29/07
-- 13:04 until the next morning because accepting was the engineer's move alone and
-- no manager could hand it to anyone.
--
-- Assignment is not acceptance: the order stays open and the engineer still accepts
-- it. What changes is that it now belongs to someone, it lands in their alerts
-- (shouldFireWOAlert only rings for the assigned engineer), and the delay stops
-- being nobody's fault.
CREATE OR REPLACE FUNCTION public.assign_work_order_engineer(_wo_id uuid, _engineer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _wo record;
  _name text;
BEGIN
  IF NOT (has_role(_uid, 'admin') OR has_role(_uid, 'maintenance_manager') OR has_role(_uid, 'manager')) THEN
    RAISE EXCEPTION 'You do not have permission to assign a maintenance order.';
  END IF;

  SELECT * INTO _wo FROM public.work_orders WHERE id = _wo_id;
  IF _wo.id IS NULL THEN RAISE EXCEPTION 'Maintenance order not found.'; END IF;
  IF _wo.status NOT IN ('open', 'received', 'arrived') THEN
    RAISE EXCEPTION 'This order is already being worked on or is closed.';
  END IF;

  IF NOT has_role(_engineer_id, 'engineer') THEN
    RAISE EXCEPTION 'That user is not an engineer.';
  END IF;

  SELECT name INTO _name FROM public.profiles WHERE id = _engineer_id;

  UPDATE public.work_orders
  SET engineer_id = _engineer_id,
      engineer_name = _name,
      -- Cleared so the assignment rings for them even if the original broadcast was
      -- already dismissed by somebody else.
      engineer_notified_acknowledged_at = NULL
  WHERE id = _wo_id;

  INSERT INTO public.notifications (user_id, wo_id, title, body, priority, action_url)
  VALUES (
    _engineer_id,
    _wo_id,
    format('WO-%s assigned to you', lpad(_wo.wo_number::text, 6, '0')),
    COALESCE(NULLIF(_wo.machine, ''), 'Maintenance order') || ' — ' || COALESCE(_wo.description, ''),
    COALESCE(_wo.priority, 'high'),
    '/dashboard/wo/' || _wo_id::text
  );

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    _uid,
    COALESCE((SELECT name FROM public.profiles WHERE id = _uid), 'Unknown'),
    'assign_engineer',
    'work_order',
    _wo_id::text,
    jsonb_build_object(
      'engineer_id', _engineer_id,
      'engineer_name', _name,
      'previous_engineer_id', _wo.engineer_id,
      'minutes_unaccepted', round(EXTRACT(EPOCH FROM (now() - _wo.created_at)) / 60)
    )
  );

  RETURN jsonb_build_object('wo_number', _wo.wo_number, 'engineer_name', _name);
END
$function$;

REVOKE ALL ON FUNCTION public.assign_work_order_engineer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_work_order_engineer(uuid, uuid) TO authenticated;

-- Who can be assigned. Reading user_roles + profiles directly from the browser
-- depends on policies that differ per role; this returns just the two fields the
-- picker needs.
CREATE OR REPLACE FUNCTION public.list_engineers()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id, COALESCE(p.name, p.email, 'Unknown')
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'engineer'
  ORDER BY 2;
$function$;

REVOKE ALL ON FUNCTION public.list_engineers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_engineers() TO authenticated;
