ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS production_line text;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rag_weekly_entries;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.production_sessions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.production_items;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;