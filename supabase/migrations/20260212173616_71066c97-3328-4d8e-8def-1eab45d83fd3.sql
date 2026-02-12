
-- 1. Harden handle_new_user: prevent race condition on first-user admin assignment
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_first_user BOOLEAN;
BEGIN
  -- Use FOR UPDATE to lock rows and prevent race condition
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles FOR UPDATE
  ) INTO is_first_user;

  INSERT INTO public.profiles (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email
  );

  IF is_first_user THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Harden log_audit_event: add input length validation to prevent log pollution
CREATE OR REPLACE FUNCTION public.log_audit_event(
  _action text,
  _entity_type text,
  _entity_id text DEFAULT NULL::text,
  _details jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate input lengths
  IF length(_action) > 100 OR length(_entity_type) > 100 THEN
    RAISE EXCEPTION 'Action or entity_type too long';
  END IF;

  IF _entity_id IS NOT NULL AND length(_entity_id) > 200 THEN
    RAISE EXCEPTION 'entity_id too long';
  END IF;

  IF pg_column_size(_details) > 10000 THEN
    RAISE EXCEPTION 'Details payload too large';
  END IF;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(),
    COALESCE((SELECT name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    _action,
    _entity_type,
    _entity_id,
    _details
  );
END;
$$;
