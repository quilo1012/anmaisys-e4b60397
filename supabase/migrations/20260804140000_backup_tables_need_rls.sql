-- Backup tables are still tables.
--
-- `_line_stopped_backfill_bak` (276 rows of work-order state) and
-- `employees_backup_dept_spelling` (5 named people and their departments) were left
-- behind by data cleanups with row-level security switched off entirely — the only
-- two tables in the schema without it. Nothing in the app reads them; anything
-- holding a token could.
--
-- A copy taken to make a fix reversible does not stop being employee data because it
-- has "backup" in its name, and a table nobody remembers is exactly the one nobody
-- thinks to secure.
--
-- Locked to admin rather than dropped: they are the undo for changes made this week
-- and last, and deleting them to close a finding would trade a small exposure for an
-- irreversible one.

ALTER TABLE public._line_stopped_backfill_bak ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees_backup_dept_spelling ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins only" ON public._line_stopped_backfill_bak
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins only" ON public.employees_backup_dept_spelling
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
