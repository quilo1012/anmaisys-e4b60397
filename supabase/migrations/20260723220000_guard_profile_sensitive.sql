-- Security: stop users from tampering with sensitive fields on their OWN profile.
-- The "Users can update own profile" RLS policy has no column restriction, so a
-- pending user could self-approve (active=true) or set their own labor_rate, etc.
-- This BEFORE UPDATE trigger forces those fields back to their stored values for
-- non-admin/non-manager callers. Admins, managers and the service role (edge
-- functions, where auth.uid() is null) are unaffected.
CREATE OR REPLACE FUNCTION public.guard_profile_sensitive()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR public.has_role(auth.uid(), 'admin'::app_role)
     OR public.has_role(auth.uid(), 'manager'::app_role) THEN
    RETURN NEW;
  END IF;
  NEW.active          := OLD.active;
  NEW.email           := OLD.email;
  NEW.labor_rate      := OLD.labor_rate;
  NEW.production_line := OLD.production_line;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_profile_sensitive ON public.profiles;
CREATE TRIGGER trg_guard_profile_sensitive
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_sensitive();
