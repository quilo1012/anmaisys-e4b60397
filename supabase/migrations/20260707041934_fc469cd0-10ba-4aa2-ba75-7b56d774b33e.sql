
CREATE TABLE IF NOT EXISTS public.rag_weekly_comments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  line TEXT NOT NULL,
  week_start DATE NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (line, week_start)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rag_weekly_comments TO authenticated;
GRANT ALL ON public.rag_weekly_comments TO service_role;

ALTER TABLE public.rag_weekly_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read rag comments"
ON public.rag_weekly_comments FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Admins and Managers can insert rag comments"
ON public.rag_weekly_comments FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Admins and Managers can update rag comments"
ON public.rag_weekly_comments FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Admins can delete rag comments"
ON public.rag_weekly_comments FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS rag_weekly_comments_week_idx
  ON public.rag_weekly_comments (week_start, line);
