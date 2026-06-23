
-- ─────────────────────────────────────────────────────────────────────────────
-- Finding: device_token_impersonation
-- Restrict SELECT on devices to admins/managers. The app never needs operators
-- to read other devices' tokens; `current_device_line_ids()` is SECURITY DEFINER
-- and already bypasses RLS for the RLS path that needs it.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Authenticated can view devices" ON public.devices;
CREATE POLICY "Admins managers can view devices" ON public.devices
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Finding: engineers_pin_hash_write_access
-- Block direct writes to pin_hash at the GRANT level. PIN updates must go
-- through public.set_engineer_pin_standalone (SECURITY DEFINER, called by the
-- admin edge function). The existing guard_engineer_pin_hash trigger stays as
-- a second line of defense.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE INSERT (pin_hash), UPDATE (pin_hash) ON public.engineers FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Finding: operator_line_accounts_email_exposure
-- The operator email is only needed server-side (tablet-signin edge function
-- resolves it with the service role). Revoke column SELECT from authenticated
-- so a signed-in operator can no longer surface the shared-account email.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE SELECT (email) ON public.operator_line_accounts FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Finding: profiles_labor_rate_exposure
-- labor_rate is admin-only. All client reads already go through
-- public.get_own_labor_rate / list_profile_labor_rates / get_profile_labor_rate
-- (SECURITY DEFINER). Lock the column out of the Data API entirely.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE SELECT (labor_rate), INSERT (labor_rate), UPDATE (labor_rate)
  ON public.profiles FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Findings: SUPA_anon_security_definer_function_executable
--           SUPA_authenticated_security_definer_function_executable
-- Default Postgres GRANTs leave EXECUTE on every SECURITY DEFINER function
-- granted to PUBLIC (and therefore anon). Strip everything down, then grant
-- back only what the app/RLS actually calls.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
  END LOOP;
END$$;

-- Re-grant ONLY the RPCs the client actually invokes. Trigger functions
-- (recalculate_health_scores, sync_*, validate_*, update_*, work_orders_set_*,
--  guard_engineer_pin_hash, handle_new_user, reduce_stock_on_parts_used) stay
-- with no API-side EXECUTE — Postgres still fires them as triggers.
GRANT EXECUTE ON FUNCTION public.accept_wo_with_pin(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_wo_alert(uuid)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_wo_collaborator(uuid, text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_device_tokens()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_device_line()                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_device_line_ids()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_device_token()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role()                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_wo_with_pin(uuid, text, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_device_line(text)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_own_labor_rate()                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profile_labor_rate(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_active_profile_names()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_engineer_names()                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_operator_account_user_ids()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_profile_labor_rates()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, text, jsonb)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_wo_retrigger(uuid, text)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_machine_to_line(uuid, text, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.pair_device(text, uuid, text)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.pair_device_lines(text, uuid[], text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_wo_as_recurrence(uuid, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_wo_recurrence(uuid, text)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_admin_pin(text)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_engineer_pin(uuid, text)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_engineer_pin_standalone(uuid, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_device(text)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_device(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_pin(text)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_engineer_pin(uuid, text)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_pin_by_code(text)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_pin_with_lockout(text)             TO authenticated;

-- Only function intentionally callable by anon (Login screen, pre-auth):
GRANT EXECUTE ON FUNCTION public.list_tablet_accounts_public() TO anon, authenticated;
