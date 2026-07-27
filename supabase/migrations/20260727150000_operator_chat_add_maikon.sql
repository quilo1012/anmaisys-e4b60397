-- Add Maikon Rosa (already an admin) to the operators' DM contact list.
-- Operators can now message Daniel, Ivan, Abner, Elias, Gustavo and Maikon;
-- Johan/Mark/Tony stay excluded. Applied live; here for the record.
CREATE OR REPLACE FUNCTION public.is_operator_chat_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = uid AND lower(email) IN (
      'daniel.quilo@appliednutrition.uk',
      'ivan.zuccolotto@appliednutrition.uk',
      'abner.silva@appliednutrition.uk',
      'elias.soares@appliednutrition.uk',
      'gustavo.mafrabraz@appliednutrition.uk',
      'maikon.rosa@appliednutrition.uk'
    )
  );
$function$;
