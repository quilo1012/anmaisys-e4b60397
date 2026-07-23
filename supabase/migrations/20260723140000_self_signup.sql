-- Self-registration with an admin-managed invite code + admin approval.
CREATE TABLE IF NOT EXISTS public.signup_config (
  id boolean PRIMARY KEY DEFAULT true,
  invite_code text,
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signup_config_singleton CHECK (id)
);
INSERT INTO public.signup_config (id, enabled) VALUES (true, false) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.signup_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signup_config FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.signup_config TO authenticated;
DROP POLICY IF EXISTS "admin manage signup_config" ON public.signup_config;
CREATE POLICY "admin manage signup_config" ON public.signup_config FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE OR REPLACE FUNCTION public.check_invite_code(code text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(bool_or(enabled AND invite_code IS NOT NULL AND invite_code = code), false)
  FROM public.signup_config WHERE id;
$$;
REVOKE ALL ON FUNCTION public.check_invite_code(text) FROM public;
GRANT EXECUTE ON FUNCTION public.check_invite_code(text) TO anon, authenticated;

-- Self-signups land PENDING (active=false, no role); admin-created stay active.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  is_first_user BOOLEAN;
  is_self BOOLEAN := (NEW.raw_user_meta_data->>'self_signup' = 'true');
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles FOR UPDATE) INTO is_first_user;
  INSERT INTO public.profiles (id, name, email, active)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email), NEW.email,
    CASE WHEN is_self AND NOT is_first_user THEN false ELSE true END);
  IF is_first_user THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END;
$function$;
