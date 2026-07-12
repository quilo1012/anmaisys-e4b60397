
ALTER TABLE public.operator_line_accounts ADD COLUMN IF NOT EXISTS favicon_url TEXT;

DROP FUNCTION IF EXISTS public.list_tablet_accounts_public();

CREATE OR REPLACE FUNCTION public.list_tablet_accounts_public()
RETURNS TABLE(id uuid, label text, line_ids uuid[], favicon_url text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT o.id, o.label, o.line_ids, o.favicon_url
  FROM public.operator_line_accounts o
  WHERE COALESCE(o.active, true) = true
  ORDER BY o.label ASC
$function$;

GRANT EXECUTE ON FUNCTION public.list_tablet_accounts_public() TO anon, authenticated;
