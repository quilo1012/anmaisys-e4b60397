
ALTER TABLE public.rag_weekly_comments ADD COLUMN IF NOT EXISTS entry_date DATE;
UPDATE public.rag_weekly_comments SET entry_date = week_start WHERE entry_date IS NULL;
ALTER TABLE public.rag_weekly_comments ALTER COLUMN entry_date SET NOT NULL;
ALTER TABLE public.rag_weekly_comments DROP CONSTRAINT IF EXISTS rag_weekly_comments_line_week_start_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rag_weekly_comments_line_entry_date_key') THEN
    ALTER TABLE public.rag_weekly_comments ADD CONSTRAINT rag_weekly_comments_line_entry_date_key UNIQUE (line, entry_date);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS rag_weekly_comments_entry_date_idx ON public.rag_weekly_comments (entry_date, line);
