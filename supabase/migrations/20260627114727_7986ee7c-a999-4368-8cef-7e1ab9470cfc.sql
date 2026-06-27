
CREATE OR REPLACE FUNCTION public.log_production_item_actual_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _sess record;
BEGIN
  IF COALESCE(NEW.actual_qty, 0) IS NOT DISTINCT FROM COALESCE(OLD.actual_qty, 0) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.name, p.email, 'Unknown') INTO _uname
    FROM public.profiles p WHERE p.id = _uid;
  _uname := COALESCE(_uname, 'system');

  SELECT ps.session_date, ps.line, ps.shift INTO _sess
    FROM public.production_sessions ps WHERE ps.id = NEW.session_id;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    _uid,
    _uname,
    'update_actual_qty',
    'production_item',
    NEW.id::text,
    jsonb_build_object(
      'session_id', NEW.session_id,
      'session_date', _sess.session_date,
      'line', _sess.line,
      'shift', _sess.shift,
      'sku_code', NEW.sku_code,
      'sku_name', NEW.sku_name,
      'target_qty', NEW.target_qty,
      'before', OLD.actual_qty,
      'after', NEW.actual_qty
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_production_item_actual_change ON public.production_items;
CREATE TRIGGER trg_log_production_item_actual_change
AFTER UPDATE OF actual_qty ON public.production_items
FOR EACH ROW
EXECUTE FUNCTION public.log_production_item_actual_change();
