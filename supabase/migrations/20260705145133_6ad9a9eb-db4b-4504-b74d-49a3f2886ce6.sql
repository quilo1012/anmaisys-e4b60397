CREATE OR REPLACE FUNCTION public.enforce_operator_production_item_update_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'operator'::app_role)
     AND NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND NOT public.has_role(auth.uid(), 'manager'::app_role)
     AND NOT public.has_role(auth.uid(), 'maintenance_manager'::app_role)
  THEN
    IF NEW.session_id IS DISTINCT FROM OLD.session_id
       OR NEW.sku_id IS DISTINCT FROM OLD.sku_id
       OR NEW.target_qty IS DISTINCT FROM OLD.target_qty
       OR NEW.planned_qty IS DISTINCT FROM OLD.planned_qty
       OR NEW.scrap_qty IS DISTINCT FROM OLD.scrap_qty
       OR NEW.intouch_qty IS DISTINCT FROM OLD.intouch_qty
       OR NEW.blender_ref IS DISTINCT FROM OLD.blender_ref
       OR NEW.target_manual_at IS DISTINCT FROM OLD.target_manual_at
       OR NEW.target_manual_by IS DISTINCT FROM OLD.target_manual_by
       OR NEW.tickets_unit IS DISTINCT FROM OLD.tickets_unit
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Operators can only update produced quantity';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_operator_production_item_update_fields ON public.production_items;
CREATE TRIGGER trg_enforce_operator_production_item_update_fields
BEFORE UPDATE ON public.production_items
FOR EACH ROW
EXECUTE FUNCTION public.enforce_operator_production_item_update_fields();