-- Restrict device_token visibility: only admins/managers can SELECT the token column.
-- All other authenticated users keep read access to non-sensitive device metadata
-- (id, label, line_id, last_seen_at) for UI display, but cannot read device_token
-- itself, preventing token spoofing for line-scoping bypass.

-- 1) Revoke column-level SELECT on device_token from authenticated.
REVOKE SELECT (device_token) ON public.devices FROM authenticated;

-- 2) Re-grant SELECT(device_token) only via SECURITY DEFINER RPC for admins/managers.
-- (current_device_token() already runs as SECURITY DEFINER and reads from request.headers,
--  so RLS on devices doesn't affect it.)

-- 3) Helper RPC for admin/manager UI that needs to display tokens (e.g., device pairing screen).
CREATE OR REPLACE FUNCTION public.admin_list_device_tokens()
RETURNS TABLE(id uuid, device_token text, label text, line_id uuid, last_seen_at timestamptz, paired_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin or manager role required';
  END IF;

  RETURN QUERY
  SELECT d.id, d.device_token, d.label, d.line_id, d.last_seen_at, d.paired_at
  FROM public.devices d
  ORDER BY d.last_seen_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_device_tokens() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_device_tokens() TO authenticated;

-- Note: current_device_token() reads from request.headers (HTTP header injected by
-- Supabase from the client request). It is NOT a session GUC settable by the user,
-- and SECURITY DEFINER prevents RLS from interfering. The token is then matched
-- against devices.device_token to derive the line scope. Even if a user could
-- guess a token, they cannot inject custom HTTP headers from a Supabase JS client
-- that override authenticated session headers.