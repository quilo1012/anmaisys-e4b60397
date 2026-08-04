-- What the company's spreadsheet calls each column.
--
-- The system says "Line 5"; the sheet says "Line 5 (A&B)". The system has Capsules
-- Machine 1 and Capsules Machine 2 as two areas; the sheet has one column called
-- "Pill line". Both are right for their own purpose, so the mapping lives in the
-- data rather than as a list of column names inside the export.
--
-- That distinction matters more than it looks. A hard-coded column list would have
-- dropped Gel Line for being empty this week and silently lost whoever is put there
-- next week. With this, an area nobody has mapped keeps its own name and still gets
-- a column.

ALTER TABLE public.headcount_areas
  ADD COLUMN IF NOT EXISTS sheet_label text,
  ADD COLUMN IF NOT EXISTS sheet_group text;

COMMENT ON COLUMN public.headcount_areas.sheet_label IS
  'What the company spreadsheet calls this area. Null means use name.';
COMMENT ON COLUMN public.headcount_areas.sheet_group IS
  'Areas sharing a value print as one column on the sheet (Capsules 1+2 = Pill line).';

UPDATE public.headcount_areas SET sheet_label = 'Line 5 (A&B)' WHERE name = 'Line 5';
UPDATE public.headcount_areas SET sheet_label = 'Line 6 (A&B)' WHERE name = 'Line 6';
UPDATE public.headcount_areas SET sheet_label = 'Tablet line'  WHERE name = 'Tablet Line';
UPDATE public.headcount_areas SET sheet_group = 'Pill line'
 WHERE name IN ('Capsules Machine 1', 'Capsules Machine 2');
