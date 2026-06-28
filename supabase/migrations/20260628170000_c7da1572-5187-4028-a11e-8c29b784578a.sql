-- Revoke EXECUTE on privileged SECURITY DEFINER RPCs from anon/authenticated.
-- These are invoked from Edge Functions using the service role only.

REVOKE EXECUTE ON FUNCTION public.verify_pin_by_code(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_engineer_pin(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_engineer_pin_standalone(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pair_device(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pair_device_lines(text, uuid[], text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unpair_device(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_profile_labor_rate(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_audit_event(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.verify_pin_by_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_engineer_pin(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_engineer_pin_standalone(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pair_device(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pair_device_lines(text, uuid[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.unpair_device(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_labor_rate(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, text, jsonb) TO service_role;