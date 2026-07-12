
CREATE OR REPLACE FUNCTION public.admin_update_auth_email(_user_id uuid, _new_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  normalized text := lower(trim(_new_email));
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager')) THEN
    RAISE EXCEPTION 'Only admins or managers may update operator emails';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = normalized AND id <> _user_id) THEN
    RAISE EXCEPTION 'This email is already in use by another login';
  END IF;

  UPDATE auth.users
  SET email = normalized,
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email', normalized),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      confirmation_token = COALESCE(confirmation_token, ''),
      email_change = '',
      email_change_token_new = '',
      email_change_token_current = '',
      recovery_token = COALESCE(recovery_token, ''),
      reauthentication_token = COALESCE(reauthentication_token, ''),
      updated_at = now()
  WHERE id = _user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auth user not found';
  END IF;

  UPDATE auth.identities
  SET identity_data = COALESCE(identity_data, '{}'::jsonb) || jsonb_build_object('email', normalized),
      email = normalized,
      updated_at = now()
  WHERE user_id = _user_id AND provider = 'email';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_auth_email(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_auth_email(uuid, text) TO authenticated, service_role;
