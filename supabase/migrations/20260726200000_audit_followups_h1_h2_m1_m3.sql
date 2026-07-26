-- Production Control security-audit follow-ups (H1, H2, M1, M3).
-- Applied directly to the live DB (Lovable doesn't deploy migrations); kept here
-- for the record.

-- ── H1: "Restore previous import" and batch cleanup could silently cascade-wipe
--        production_targets and sku_production_history ───────────────────────
-- Both child FKs were ON DELETE CASCADE and their sku_id is NOT NULL (so SET NULL
-- isn't possible). restore_sku_products_from_backup() did DELETE FROM sku_products
-- + re-insert, cascading away all targets/history. Make restore non-destructive
-- (upsert + delete only unreferenced orphans) and switch the FKs to RESTRICT so no
-- path can silently cascade-wipe those tables.

CREATE OR REPLACE FUNCTION public.restore_sku_products_from_backup()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _n int; _removed int;
BEGIN
  IF _uid IS NULL OR NOT (has_role(_uid,'admin'::app_role) OR has_role(_uid,'manager'::app_role) OR has_role(_uid,'supervisor'::app_role)) THEN
    RAISE EXCEPTION 'Forbidden: admin, manager or supervisor role required';
  END IF;
  SELECT count(*) INTO _n FROM public.sku_products_backup;
  IF _n = 0 THEN RAISE EXCEPTION 'No previous import to restore'; END IF;

  INSERT INTO public.sku_products AS s
    (id, code, name, category, target_per_hour, active, created_at, updated_at, weight, notes)
  SELECT id, code, name, category, target_per_hour, active, created_at, updated_at, weight, notes
  FROM public.sku_products_backup
  ON CONFLICT (id) DO UPDATE SET
    code = EXCLUDED.code, name = EXCLUDED.name, category = EXCLUDED.category,
    target_per_hour = EXCLUDED.target_per_hour, active = EXCLUDED.active,
    weight = EXCLUDED.weight, notes = EXCLUDED.notes, updated_at = now();

  DELETE FROM public.sku_products s
  WHERE NOT EXISTS (SELECT 1 FROM public.sku_products_backup b WHERE b.id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.production_items pi WHERE pi.sku_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.production_targets pt WHERE pt.sku_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.sku_production_history h WHERE h.sku_id = s.id);
  GET DIAGNOSTICS _removed = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'count', _n, 'removed', _removed);
END; $function$;

-- cleanup_batch_skus already only deletes batch SKUs with no production_items;
-- extend the guard so RESTRICT can't make it error on targets/history either.
CREATE OR REPLACE FUNCTION public.cleanup_batch_skus()
 RETURNS TABLE(repointed integer, deleted integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _rep integer; _del integer;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'supervisor')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  WITH batch AS (
    SELECT s.id, regexp_replace(s.code, '\s*-\s*B[0-9]+\s*$', '') AS base_code
    FROM public.sku_products s WHERE s.code ~ '\s*-\s*B[0-9]+\s*$'
  ), mapping AS (
    SELECT b.id AS batch_id, base.id AS base_id
    FROM batch b JOIN public.sku_products base ON base.code = b.base_code
  )
  UPDATE public.production_items pi SET sku_id = m.base_id FROM mapping m WHERE pi.sku_id = m.batch_id;
  GET DIAGNOSTICS _rep = ROW_COUNT;
  DELETE FROM public.sku_products s
  WHERE s.code ~ '\s*-\s*B[0-9]+\s*$'
    AND EXISTS (SELECT 1 FROM public.sku_products base WHERE base.code = regexp_replace(s.code, '\s*-\s*B[0-9]+\s*$',''))
    AND NOT EXISTS (SELECT 1 FROM public.production_items pi WHERE pi.sku_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.production_targets pt WHERE pt.sku_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.sku_production_history h WHERE h.sku_id = s.id);
  GET DIAGNOSTICS _del = ROW_COUNT;
  RETURN QUERY SELECT _rep, _del;
END $function$;

ALTER TABLE public.production_targets DROP CONSTRAINT production_targets_sku_id_fkey;
ALTER TABLE public.production_targets
  ADD CONSTRAINT production_targets_sku_id_fkey
  FOREIGN KEY (sku_id) REFERENCES public.sku_products(id) ON DELETE RESTRICT;

ALTER TABLE public.sku_production_history DROP CONSTRAINT sku_production_history_sku_id_fkey;
ALTER TABLE public.sku_production_history
  ADD CONSTRAINT sku_production_history_sku_id_fkey
  FOREIGN KEY (sku_id) REFERENCES public.sku_products(id) ON DELETE RESTRICT;

-- ── H2: session/item deletes cascade into items/blenders with no audit trail ──
-- Rather than block admin deletes (RESTRICT would break normal session removal),
-- log every deleted row (full row via to_jsonb) to audit_logs so any delete —
-- including a cascade from a session delete — is recoverable, as the actual_qty
-- audit log was for the Line 4 recovery.

CREATE OR REPLACE FUNCTION public.log_production_item_delete()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _uname text; _sess record; _sku record;
BEGIN
  SELECT COALESCE(p.name, p.email, 'Unknown') INTO _uname FROM public.profiles p WHERE p.id = _uid;
  _uname := COALESCE(_uname, 'system');
  SELECT ps.session_date, ps.line, ps.shift INTO _sess FROM public.production_sessions ps WHERE ps.id = OLD.session_id;
  SELECT sp.code, sp.name INTO _sku FROM public.sku_products sp WHERE sp.id = OLD.sku_id;
  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (_uid, _uname, 'delete_production_item', 'production_item', OLD.id::text,
    jsonb_build_object(
      'session_id', OLD.session_id, 'session_date', _sess.session_date,
      'line', _sess.line, 'shift', _sess.shift,
      'sku_code', COALESCE(_sku.code, OLD.sku_code_text), 'sku_name', _sku.name,
      'actual_qty', OLD.actual_qty, 'row', to_jsonb(OLD)));
  RETURN OLD;
END; $function$;

DROP TRIGGER IF EXISTS trg_log_production_item_delete ON public.production_items;
CREATE TRIGGER trg_log_production_item_delete
  AFTER DELETE ON public.production_items
  FOR EACH ROW EXECUTE FUNCTION public.log_production_item_delete();

CREATE OR REPLACE FUNCTION public.log_blender_entry_delete()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _uname text; _sess record;
BEGIN
  SELECT COALESCE(p.name, p.email, 'Unknown') INTO _uname FROM public.profiles p WHERE p.id = _uid;
  _uname := COALESCE(_uname, 'system');
  SELECT ps.session_date, ps.line, ps.shift INTO _sess FROM public.production_sessions ps WHERE ps.id = OLD.session_id;
  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (_uid, _uname, 'delete_blender_entry', 'production_blender_entry', OLD.id::text,
    jsonb_build_object(
      'session_id', OLD.session_id, 'session_date', _sess.session_date,
      'line', _sess.line, 'shift', _sess.shift,
      'production_item_id', OLD.production_item_id, 'row', to_jsonb(OLD)));
  RETURN OLD;
END; $function$;

DROP TRIGGER IF EXISTS trg_log_blender_entry_delete ON public.production_blender_entries;
CREATE TRIGGER trg_log_blender_entry_delete
  AFTER DELETE ON public.production_blender_entries
  FOR EACH ROW EXECUTE FUNCTION public.log_blender_entry_delete();

-- ── M1: sync_item_actual_from_blenders zeroed imported actuals ───────────────
-- The trigger unconditionally set actual_qty = SUM(blenders). Adding then removing
-- a blender on an imported/direct item wiped its actual_qty to 0. Only drive
-- actual_qty from blenders WHILE blender entries exist; when the last one is
-- removed, leave actual_qty untouched (the item is editable again in the UI).

CREATE OR REPLACE FUNCTION public.sync_item_actual_from_blenders()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _item_id uuid; _sum integer;
BEGIN
  _item_id := COALESCE(NEW.production_item_id, OLD.production_item_id);
  IF EXISTS (SELECT 1 FROM public.production_blender_entries WHERE production_item_id = _item_id) THEN
    SELECT COALESCE(SUM(quantity),0) INTO _sum
      FROM public.production_blender_entries WHERE production_item_id = _item_id;
    UPDATE public.production_items SET actual_qty = _sum, updated_at = now() WHERE id = _item_id;
  END IF;
  RETURN NULL;
END; $function$;

-- ── M3: drop redundant anon table grants (RLS already blocks anon; least-priv) ─
REVOKE ALL ON public.audit_logs FROM anon;
REVOKE ALL ON public.user_roles FROM anon;
REVOKE ALL ON public.operator_line_accounts FROM anon;
REVOKE ALL ON public.sku_products_backup FROM anon;
