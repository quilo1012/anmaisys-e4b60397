-- Smart Target: each product's allergens, for the deep clean rule (decided 10/11, Q82).
--
-- WHY. The line plans in "Time and motion studies New.xlsx" put a full blend clean-down
-- (about 240 min) between a product with milk and one without, and a drill clean (about
-- 120 min) between flavours. Smart Target now charges those cleans, and to tell the two
-- apart it needs to know which products carry milk (or gluten, or anything else). The
-- catalogue had no such field.
--
-- WHAT. One nullable column. NULL means nobody has confirmed it yet: the page then uses a
-- suggestion from the product's name and says so. An empty list means confirmed: none.
-- Edited on SKU Products by whoever may already edit a product; no new grant or policy.

alter table public.sku_products add column if not exists allergens text[];

comment on column public.sku_products.allergens is
  'Allergens in the product (e.g. {Milk,Gluten}). NULL = not confirmed; {} = confirmed none. Used by Smart Target for the deep clean rule.';
