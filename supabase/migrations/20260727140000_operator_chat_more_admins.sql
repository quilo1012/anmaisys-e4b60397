-- Operators' DM contact list showed only supervisors + one designated admin
-- (Daniel). Extend is_operator_chat_admin so operators can also message
-- Ivan, Abner, Elias and Gustavo (and those admins see operators to reply).
-- Johan / Mark / Tony are intentionally excluded. Applied live; here for record.
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
      'gustavo.mafrabraz@appliednutrition.uk'
    )
  );
$function$;
