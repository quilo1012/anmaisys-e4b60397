ALTER TABLE public.intouch_stop_code_map
  ADD COLUMN IF NOT EXISTS requires_wo boolean NOT NULL DEFAULT true;