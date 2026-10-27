CREATE OR REPLACE FUNCTION public.list_engineer_names()
RETURNS TABLE(id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT e.id, e.name
  FROM public.engineers e
  WHERE e.is_active = true
    AND auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND coalesce(p.active, true))
  ORDER BY e.name
$$;
REVOKE ALL ON FUNCTION public.list_engineer_names() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_engineer_names() TO authenticated;
REVOKE ALL ON FUNCTION public.communication_touch_presence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.communication_touch_presence(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_sku_production_identity()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'A SKU identity cannot be changed. Edit its attributes instead.' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.production_targets t WHERE t.sku_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.production_items i WHERE i.sku_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.sku_production_history h WHERE h.sku_id = OLD.id) THEN
    RAISE EXCEPTION 'This SKU has production targets or production history and cannot be deleted. Deactivate it instead; all records will be kept.' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_sku_production_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_sku_production_identity
BEFORE DELETE OR UPDATE OF id ON public.sku_products
FOR EACH ROW EXECUTE FUNCTION public.protect_sku_production_identity();
NOTIFY pgrst, 'reload schema';