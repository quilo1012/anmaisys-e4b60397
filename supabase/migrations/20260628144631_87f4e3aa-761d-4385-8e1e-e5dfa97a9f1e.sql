
CREATE OR REPLACE FUNCTION public.log_production_item_target_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _sess record;
  _sku record;
  _is_manual boolean;
BEGIN
  IF COALESCE(NEW.target_qty, 0) IS NOT DISTINCT FROM COALESCE(OLD.target_qty, 0) THEN
    RETURN NEW;
  END IF;

  _is_manual := _uid IS NOT NULL;
  IF _is_manual THEN
    NEW.target_manual_at := now();
    NEW.target_manual_by := _uid;
  END IF;

  SELECT COALESCE(p.name, p.email, 'system') INTO _uname
    FROM public.profiles p WHERE p.id = _uid;
  _uname := COALESCE(_uname, 'itouching_sync');

  SELECT ps.session_date, ps.line, ps.shift INTO _sess
    FROM public.production_sessions ps WHERE ps.id = NEW.session_id;

  SELECT sp.code, sp.name INTO _sku
    FROM public.sku_products sp WHERE sp.id = NEW.sku_id;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    _uid, _uname, 'update_target_qty', 'production_item', NEW.id::text,
    jsonb_build_object(
      'session_id', NEW.session_id,
      'session_date', _sess.session_date,
      'line', _sess.line,
      'shift', _sess.shift,
      'sku_code', _sku.code,
      'sku_name', _sku.name,
      'before', OLD.target_qty,
      'after', NEW.target_qty,
      'manual', _is_manual
    )
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.log_production_item_actual_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _sess record;
  _sku record;
BEGIN
  IF COALESCE(NEW.actual_qty, 0) IS NOT DISTINCT FROM COALESCE(OLD.actual_qty, 0) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.name, p.email, 'Unknown') INTO _uname
    FROM public.profiles p WHERE p.id = _uid;
  _uname := COALESCE(_uname, 'system');

  SELECT ps.session_date, ps.line, ps.shift INTO _sess
    FROM public.production_sessions ps WHERE ps.id = NEW.session_id;

  SELECT sp.code, sp.name INTO _sku
    FROM public.sku_products sp WHERE sp.id = NEW.sku_id;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    _uid, _uname, 'update_actual_qty', 'production_item', NEW.id::text,
    jsonb_build_object(
      'session_id', NEW.session_id,
      'session_date', _sess.session_date,
      'line', _sess.line,
      'shift', _sess.shift,
      'sku_code', _sku.code,
      'sku_name', _sku.name,
      'target_qty', NEW.target_qty,
      'before', OLD.actual_qty,
      'after', NEW.actual_qty
    )
  );
  RETURN NEW;
END;
$function$;
