-- ITEM 4 — Backend validation of line_id for operator-created WOs + audit log
CREATE OR REPLACE FUNCTION public.enforce_operator_wo_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _is_operator boolean;
  _allowed uuid[];
  _uname text;
BEGIN
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only enforce for operator role; admin/manager/engineer are unrestricted
  _is_operator := public.has_role(_uid, 'operator'::app_role);
  IF NOT _is_operator THEN
    RETURN NEW;
  END IF;

  IF NEW.line_id IS NULL THEN
    RAISE EXCEPTION 'Operators must open work orders with a line_id';
  END IF;

  SELECT line_ids INTO _allowed
    FROM public.operator_line_accounts
   WHERE user_id = _uid;

  IF _allowed IS NULL OR NOT (NEW.line_id = ANY(_allowed)) THEN
    RAISE EXCEPTION 'Forbidden: line_id % is not bound to this operator account', NEW.line_id;
  END IF;

  -- Stamp operator_id defensively (client also sets it)
  NEW.operator_id := COALESCE(NEW.operator_id, _uid);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_operator_wo_line ON public.work_orders;
CREATE TRIGGER trg_enforce_operator_wo_line
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_operator_wo_line();

-- Audit trail: log every WO creation with key context
CREATE OR REPLACE FUNCTION public.audit_work_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
BEGIN
  SELECT COALESCE(p.name, p.email, 'system') INTO _uname
    FROM public.profiles p WHERE p.id = _uid;
  _uname := COALESCE(_uname, 'system');

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    _uid, _uname, 'wo_created', 'work_order', NEW.id::text,
    jsonb_build_object(
      'wo_number', NEW.wo_number,
      'line_id', NEW.line_id,
      'line_at_time', NEW.line_at_time,
      'machine', NEW.machine,
      'requester_name', NEW.requester_name,
      'priority', NEW.priority,
      'line_stopped', NEW.line_stopped
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- never block insert because of audit failure
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_work_order_insert ON public.work_orders;
CREATE TRIGGER trg_audit_work_order_insert
  AFTER INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_work_order_insert();