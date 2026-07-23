-- When production is logged (production_items) with a batch (blender_ref), back-fill
-- the SKU on any quality action that was opened with that batch but no SKU yet.
-- Lets a supervisor log a quality action by batch even before the operator has
-- entered production; the SKU syncs automatically once production is entered.
CREATE OR REPLACE FUNCTION public.sync_quality_action_sku()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE sku_txt text;
BEGIN
  IF NEW.blender_ref IS NULL OR NEW.blender_ref = '' THEN
    RETURN NEW;
  END IF;
  sku_txt := COALESCE(NULLIF(NEW.sku_code_text, ''), (SELECT code FROM public.sku_products WHERE id = NEW.sku_id));
  IF sku_txt IS NULL OR sku_txt = '' THEN
    RETURN NEW;
  END IF;
  UPDATE public.quality_actions
    SET sku = sku_txt
    WHERE batch = NEW.blender_ref AND (sku IS NULL OR sku = '');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_qa_sku ON public.production_items;
CREATE TRIGGER trg_sync_qa_sku
  AFTER INSERT OR UPDATE OF blender_ref, sku_id, sku_code_text ON public.production_items
  FOR EACH ROW EXECUTE FUNCTION public.sync_quality_action_sku();
