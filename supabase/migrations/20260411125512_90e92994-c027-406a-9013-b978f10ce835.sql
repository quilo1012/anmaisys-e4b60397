
CREATE OR REPLACE FUNCTION public.set_admin_pin(_new_pin text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  UPDATE system_settings
  SET admin_pin = crypt(_new_pin, gen_salt('bf')),
      updated_at = now()
  WHERE id = (SELECT id FROM system_settings LIMIT 1);
END;
$function$;
