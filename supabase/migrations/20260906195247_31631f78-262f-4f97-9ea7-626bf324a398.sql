ALTER TABLE public.sc_sync_state
  ADD COLUMN IF NOT EXISTS page_token text,
  ADD COLUMN IF NOT EXISTS backfill_complete boolean NOT NULL DEFAULT false;