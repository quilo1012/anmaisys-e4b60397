DROP POLICY IF EXISTS "Authenticated can read baselines" ON public.line_production_baselines;

CREATE POLICY "line_baselines_read_ops"
ON public.line_production_baselines
FOR SELECT
TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','manager','supervisor','planner','production_office_admin','quality_supervisor','maintenance_manager','engineer','co_engineer','operator']::app_role[]));

CREATE OR REPLACE FUNCTION public.guard_engineer_pin_hash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.pin_hash IS NOT NULL AND NEW.pin_hash <> '' AND NEW.pin_hash <> 'temp' THEN
      RAISE EXCEPTION 'Only admins may set pin_hash directly. Use set_engineer_pin_standalone().';
    END IF;
    IF NEW.labor_rate IS NOT NULL THEN
      RAISE EXCEPTION 'Only admins may set labor_rate.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.pin_hash IS DISTINCT FROM OLD.pin_hash THEN
      RAISE EXCEPTION 'Only admins may modify pin_hash directly. Use set_engineer_pin_standalone().';
    END IF;
    IF NEW.labor_rate IS DISTINCT FROM OLD.labor_rate THEN
      RAISE EXCEPTION 'Only admins may modify labor_rate.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$function$;