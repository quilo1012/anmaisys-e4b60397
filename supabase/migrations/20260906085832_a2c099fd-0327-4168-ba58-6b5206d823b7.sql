ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS rag_api_base_url text;