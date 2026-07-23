-- Notify all admins when someone self-registers and is pending approval.
-- (handle_new_user already creates self-signups as inactive + no role.)
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_first_user BOOLEAN;
  is_self BOOLEAN := (NEW.raw_user_meta_data->>'self_signup' = 'true');
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles FOR UPDATE) INTO is_first_user;

  INSERT INTO public.profiles (id, name, email, active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email,
    CASE WHEN is_self AND NOT is_first_user THEN false ELSE true END
  );

  IF is_first_user THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;

  IF is_self AND NOT is_first_user THEN
    INSERT INTO public.notifications (user_id, title, body, priority, action_url)
    SELECT ur.user_id,
           'New account pending approval',
           COALESCE(NEW.raw_user_meta_data->>'name', NEW.email) || ' registered and needs a role.',
           'high',
           '/users/manage'
    FROM public.user_roles ur
    WHERE ur.role = 'admin';
  END IF;

  RETURN NEW;
END;
$function$;
