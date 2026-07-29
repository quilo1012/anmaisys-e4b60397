-- Turning the iTouching production sync back ON now requires the admin PIN.
--
-- Context: that sync writes production_items. On 29/07 it deleted four
-- operator-logged rows totalling 11,473 units, and the audit log shows the same
-- on 26, 27 and 28 July (~19,000 units). It is switched off, and re-enabling it
-- must be a deliberate, authenticated, audited act — not a toggle someone flips
-- while looking for something else.
--
-- Enforced server-side. A prompt in the UI alone would be theatre: admins have
-- ALL on system_settings, so anyone could flip the column straight through the
-- REST API. The column GRANT below closes that; the RPC is the only way in.

CREATE OR REPLACE FUNCTION public.set_intouch_sync_enabled(_enabled boolean, _pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _uid uuid := auth.uid();
  _name text;
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  -- PIN only guards switching the sync ON. Making the safe direction harder to
  -- reach would be backwards: anyone with admin must always be able to stop it.
  IF _enabled AND (_pin IS NULL OR NOT public.verify_admin_pin(_pin)) THEN
    RAISE EXCEPTION 'Incorrect admin PIN';
  END IF;

  UPDATE public.system_settings SET intouch_sync_enabled = _enabled;

  SELECT name INTO _name FROM public.profiles WHERE id = _uid;
  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, details)
  VALUES (
    _uid,
    COALESCE(_name, 'admin'),
    CASE WHEN _enabled THEN 'intouch_sync_enabled' ELSE 'intouch_sync_disabled' END,
    'system_settings',
    jsonb_build_object('enabled', _enabled, 'at', now())
  );

  RETURN _enabled;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_intouch_sync_enabled(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_intouch_sync_enabled(boolean, text) TO authenticated;

COMMENT ON FUNCTION public.set_intouch_sync_enabled(boolean, text) IS
  'Only way to change system_settings.intouch_sync_enabled. Requires the admin role AND the admin PIN, and writes an audit_logs entry.';

-- Direct column writes are revoked so the PIN cannot be routed around.
--
-- NOTE: a table-level UPDATE grant covers EVERY column, so revoking one column
-- on its own does nothing (the same trap that left profiles.labor_rate readable
-- until 20260724130000). Drop the table-level grant and re-grant every column
-- except this one. When a column is added to system_settings, GRANT it here too.
REVOKE UPDATE ON public.system_settings FROM authenticated, anon;
GRANT UPDATE (id, admin_pin, created_at, updated_at, intouch_auto_wo_enabled)
  ON public.system_settings TO authenticated;
