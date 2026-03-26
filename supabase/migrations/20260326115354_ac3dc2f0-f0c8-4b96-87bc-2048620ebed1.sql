
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price numeric NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS labor_rate numeric NOT NULL DEFAULT 0;
