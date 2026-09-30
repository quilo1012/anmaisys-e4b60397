-- Set minimum replenishment alert for all belts to 2 units
UPDATE public.products
SET min_stock = 2
WHERE lower(coalesce(name, '')) LIKE '%belt%'
   OR lower(coalesce(code, '')) LIKE '%belt%';
