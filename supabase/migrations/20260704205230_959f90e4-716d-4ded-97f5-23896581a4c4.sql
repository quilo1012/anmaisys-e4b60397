ALTER TABLE public.engineers ADD COLUMN IF NOT EXISTS labor_rate numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.list_engineer_labor_rates()
RETURNS TABLE(id uuid, name text, labor_rate numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'Forbidden: admin or manager role required';
  END IF;
  RETURN QUERY SELECT e.id, e.name, e.labor_rate FROM public.engineers e;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_engineer_labor_rates() TO authenticated;