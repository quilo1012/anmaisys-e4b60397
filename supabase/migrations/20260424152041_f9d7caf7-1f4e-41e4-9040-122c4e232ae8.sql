CREATE OR REPLACE FUNCTION public.validate_downtime_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.category NOT IN ('Mechanical', 'Electrical', 'Machine', 'Maintenance', 'Filler', 'Other') THEN
    RAISE EXCEPTION 'Invalid downtime category: %', NEW.category;
  END IF;
  RETURN NEW;
END;
$function$;