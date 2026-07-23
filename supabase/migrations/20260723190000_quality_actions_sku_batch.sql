-- Capture the SKU and batch code on a quality action. These are auto-filled in
-- the "Log action" form from the production data (line + date + shift) and the
-- supervisor corrects them as needed.
ALTER TABLE public.quality_actions ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.quality_actions ADD COLUMN IF NOT EXISTS batch text;
