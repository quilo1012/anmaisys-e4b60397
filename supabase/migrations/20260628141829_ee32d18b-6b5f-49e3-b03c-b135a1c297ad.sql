
-- 1) Track manual target edits per production_item
ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS target_manual_at timestamptz,
  ADD COLUMN IF NOT EXISTS target_manual_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2) Audit trigger: log production_items.target_qty changes
CREATE OR REPLACE FUNCTION public.log_production_item_target_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
  _sess record;
  _is_manual boolean;
BEGIN
  IF COALESCE(NEW.target_qty, 0) IS NOT DISTINCT FROM COALESCE(OLD.target_qty, 0) THEN
    RETURN NEW;
  END IF;

  -- A change driven by an authenticated user is considered a manual override.
  -- Service-role syncs (auth.uid() IS NULL) leave the manual flag untouched.
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

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    _uid,
    _uname,
    'update_target_qty',
    'production_item',
    NEW.id::text,
    jsonb_build_object(
      'session_id', NEW.session_id,
      'session_date', _sess.session_date,
      'line', _sess.line,
      'shift', _sess.shift,
      'sku_code', NEW.sku_code,
      'sku_name', NEW.sku_name,
      'before', OLD.target_qty,
      'after', NEW.target_qty,
      'manual', _is_manual
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_production_item_target_change ON public.production_items;
CREATE TRIGGER trg_log_production_item_target_change
  BEFORE UPDATE OF target_qty ON public.production_items
  FOR EACH ROW EXECUTE FUNCTION public.log_production_item_target_change();

-- 3) Audit trigger: log rag_weekly_entries.plan_qty changes
CREATE OR REPLACE FUNCTION public.log_rag_plan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _uname text;
BEGIN
  IF COALESCE(NEW.plan_qty, 0) IS NOT DISTINCT FROM COALESCE(OLD.plan_qty, 0) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.name, p.email, 'system') INTO _uname
    FROM public.profiles p WHERE p.id = _uid;
  _uname := COALESCE(_uname, 'system');

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    _uid,
    _uname,
    'update_rag_plan_qty',
    'rag_weekly_entry',
    NEW.id::text,
    jsonb_build_object(
      'entry_date', NEW.entry_date,
      'line', NEW.line,
      'shift', NEW.shift,
      'before', OLD.plan_qty,
      'after', NEW.plan_qty
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_rag_plan_change ON public.rag_weekly_entries;
CREATE TRIGGER trg_log_rag_plan_change
  AFTER UPDATE OF plan_qty ON public.rag_weekly_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_rag_plan_change();
