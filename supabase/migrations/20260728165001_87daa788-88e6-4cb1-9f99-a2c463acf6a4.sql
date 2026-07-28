ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS destination text,
  ADD COLUMN IF NOT EXISTS not_for_eu boolean NOT NULL DEFAULT false;