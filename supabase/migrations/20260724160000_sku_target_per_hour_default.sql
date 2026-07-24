-- New SKU / imports that omit a target failed the NOT NULL constraint on
-- target_per_hour. Give it a default of 0 (it's an optional field) so inserts
-- that don't provide it succeed.
ALTER TABLE public.sku_products ALTER COLUMN target_per_hour SET DEFAULT 0;
UPDATE public.sku_products SET target_per_hour = 0 WHERE target_per_hour IS NULL;
