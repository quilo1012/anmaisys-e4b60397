-- Free-text SKU code for production entries logged against a code that is not
-- in the catalog. sku_id stays NULL; admin reconciles the real SKU later.
-- No new sku_products row is created from operator input.
ALTER TABLE public.production_items ADD COLUMN IF NOT EXISTS sku_code_text text;
